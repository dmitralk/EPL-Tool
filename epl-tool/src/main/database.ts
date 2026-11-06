import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { createBackup, isHealthy } from './backup';
import { getResolvedIdentity } from './auth';
import type { DbOpenError } from '../types';

let db: Database.Database | null = null;
let currentPath: string | null = null;
let lastOpenError: DbOpenError | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone TEXT, country TEXT, customer_type TEXT, comment_on_business_model TEXT,
  customer_ref_type_sap TEXT, customer_ref_sap TEXT NOT NULL UNIQUE,
  customer_short_name TEXT NOT NULL, customer_full_name TEXT NOT NULL,
  currency TEXT NOT NULL,
  packaging_version TEXT NOT NULL,
  price_list_managed_by TEXT, customer_spoc TEXT,
  effective TEXT, mailing_date TEXT,
  last_price_list_version TEXT, last_price_list_id TEXT,
  email_to_customer TEXT, email_internal_copy TEXT,
  email_pbp_copy TEXT, email_pbp_common TEXT
);

CREATE TABLE IF NOT EXISTS currencies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  is_main INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plant TEXT, product_type TEXT NOT NULL,
  rip_code TEXT NOT NULL UNIQUE, product_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS standard_epl_versions (
  version_id     INTEGER PRIMARY KEY,
  version_name   TEXT NOT NULL,
  status         TEXT NOT NULL CHECK (status IN ('draft','published')),
  effective_from DATE,
  notes          TEXT,
  created_at     DATETIME DEFAULT (datetime('now')),
  published_at   DATETIME
);

CREATE TABLE IF NOT EXISTS standard_epl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version_id INTEGER NOT NULL REFERENCES standard_epl_versions(version_id),
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
  product_type TEXT NOT NULL, rip_code TEXT NOT NULL,
  product_name TEXT NOT NULL, net_price REAL NOT NULL, unit TEXT NOT NULL,
  UNIQUE (version_id, currency, rip_code)
);

CREATE TABLE IF NOT EXISTS packaging (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  packaging_version TEXT NOT NULL, product_type TEXT NOT NULL,
  packaging_name TEXT NOT NULL, price REAL,
  currency TEXT NOT NULL, unit TEXT, sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS price_lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_list_id TEXT NOT NULL UNIQUE,
  customer_ref_sap TEXT NOT NULL,
  sap_plant TEXT, effective TEXT NOT NULL, mailing_date TEXT NOT NULL,
  price_list_version TEXT NOT NULL, comments_about_changes TEXT,
  price_type TEXT NOT NULL CHECK (price_type IN ('Discount','Net Price','PrevPercent','PrevAbsolute')),
  discount_percent REAL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS price_list_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  price_list_id TEXT NOT NULL,
  product_type TEXT NOT NULL, rip_code TEXT NOT NULL,
  product_name TEXT NOT NULL, net_price REAL NOT NULL,
  currency TEXT NOT NULL, unit TEXT NOT NULL,
  FOREIGN KEY (price_list_id) REFERENCES price_lists(price_list_id)
);

CREATE TABLE IF NOT EXISTS admin_emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_name TEXT NOT NULL UNIQUE, email TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY, value TEXT
);

CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS fx_rates (
  currency_code TEXT PRIMARY KEY,
  rate_to_usd REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_price_lists_customer ON price_lists(customer_ref_sap);
CREATE INDEX IF NOT EXISTS idx_price_list_entries_pl ON price_list_entries(price_list_id);
CREATE INDEX IF NOT EXISTS idx_standard_epl_currency ON standard_epl(currency);
`;

// units/currencies use NOT EXISTS instead of INSERT OR IGNORE: on AUTOINCREMENT tables an ignored insert still
// rewrites sqlite_sequence, which would change the database file on every open.
const SEED_SQL = `
INSERT INTO units (name) SELECT v.name FROM (SELECT '100 KG' AS name UNION ALL SELECT '100 L') v
  WHERE NOT EXISTS (SELECT 1 FROM units u WHERE u.name = v.name);
INSERT INTO currencies (code, is_main) SELECT v.code, 1 FROM (SELECT 'USD' AS code UNION ALL SELECT 'EUR') v
  WHERE NOT EXISTS (SELECT 1 FROM currencies c WHERE c.code = v.code);
INSERT OR IGNORE INTO fx_rates (currency_code, rate_to_usd) VALUES ('USD', 1), ('EUR', 1.08), ('GBP', 1.27);
INSERT OR IGNORE INTO standard_epl_versions (version_id, version_name, status, effective_from, published_at)
  VALUES (1, 'Initial', 'published', date('now'), datetime('now'));
`;

// Schema version = PRAGMA user_version. Databases from before the numbering (user_version 0) run the detection-based
// legacy steps 1–6 once and are stamped 6. SCHEMA_SQL and SEED_SQL are frozen at that v6 baseline: every later schema
// change must be a numbered entry in MIGRATIONS (version 7, 8, …), never an edit of SCHEMA_SQL.
const LEGACY_SCHEMA_VERSION = 6;

interface Migration {
  version: number;
  up: (db: Database.Database) => void;
}

// Migration 7 — access rights (access-rights study §5): user list, per-customer pricing mode and managers,
// price list creator, activity log. Every existing customer starts as 'pbp'; the free-text "Managed by" is dropped.
const MIGRATION_7_SQL = `
CREATE TABLE users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name TEXT NOT NULL,
  email        TEXT UNIQUE COLLATE NOCASE,
  account      TEXT UNIQUE COLLATE NOCASE,
  role         TEXT NOT NULL CHECK (role IN ('admin','user','viewer')),
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT DEFAULT (datetime('now')),
  CHECK (email IS NOT NULL OR account IS NOT NULL)
);

ALTER TABLE customers ADD COLUMN pricing_mode TEXT NOT NULL DEFAULT 'pbp'
  CHECK (pricing_mode IN ('open','pbp','managed'));
ALTER TABLE customers DROP COLUMN price_list_managed_by;

CREATE TABLE customer_managers (
  customer_ref_sap TEXT NOT NULL REFERENCES customers(customer_ref_sap) ON DELETE CASCADE,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  PRIMARY KEY (customer_ref_sap, user_id)
);
CREATE INDEX idx_customer_managers_user ON customer_managers(user_id);

ALTER TABLE price_lists ADD COLUMN created_by_user_id INTEGER REFERENCES users(id);

CREATE TABLE audit_log (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
  user_id          INTEGER REFERENCES users(id),
  user_label       TEXT NOT NULL,
  action           TEXT NOT NULL,
  entity_type      TEXT,
  entity_key       TEXT,
  customer_ref_sap TEXT,
  summary          TEXT NOT NULL,
  details          TEXT
);
CREATE INDEX idx_audit_at       ON audit_log(at);
CREATE INDEX idx_audit_customer ON audit_log(customer_ref_sap);
`;

const MIGRATIONS: Migration[] = [
  { version: 7, up: db => db.exec(MIGRATION_7_SQL) },
];

export const SCHEMA_VERSION = MIGRATIONS.reduce((v, m) => Math.max(v, m.version), LEGACY_SCHEMA_VERSION);

function schemaVersion(db: Database.Database): number {
  return db.pragma('user_version', { simple: true }) as number;
}

export function openDatabase(filePath: string, opts: { skipBackup?: boolean; create?: boolean } = {}): void {
  if (currentPath && path.resolve(currentPath) === path.resolve(filePath)) closeDatabase();
  const existed = fs.existsSync(filePath) && fs.statSync(filePath).size > 0;
  let next: Database.Database | null = null;
  try {
    // Without fileMustExist a not-yet-synced SharePoint file would be silently replaced by an empty DB.
    next = new Database(filePath, { fileMustExist: !opts.create });
    // Rollback journal keeps the .db self-contained; WAL's separate -wal file breaks under OneDrive/SharePoint sync.
    next.pragma('journal_mode = DELETE');
    if (!isHealthy(next)) throw new Error('Database integrity check failed (PRAGMA quick_check).');
    const fileVersion = schemaVersion(next);
    if (fileVersion > SCHEMA_VERSION) {
      throw new Error(
        `This database needs a newer version of EPL Tool (database schema ${fileVersion}, this app supports up to ` +
        `${SCHEMA_VERSION}). Please update EPL Tool.`,
      );
    }
  } catch (err) {
    try { next?.close(); } catch { /* ignore */ }
    closeDatabase();
    const message = (err as Error).message;
    lastOpenError = {
      path: filePath,
      message,
      corrupt: /integrity check|malformed|not a database|corrupt/i.test(message),
    };
    throw err;
  }

  closeDatabase();
  db = next;
  currentPath = filePath;
  lastOpenError = null;

  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = FULL');

  if (existed && !opts.skipBackup) {
    try {
      createBackup(db, filePath);
    } catch {
      // status is recorded by createBackup and surfaced in Settings; never block opening
    }
  }

  db.exec(SCHEMA_SQL);
  db.exec(SEED_SQL);
  migrate(db);
  bootstrapFirstAdmin(db);
}

// A database without any user (just upgraded by Migration 7, or new) makes the person opening it the first admin.
// Callers must await getIdentity() before openDatabase so the identity is known here.
function bootstrapFirstAdmin(db: Database.Database): void {
  if ((db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n > 0) return;
  const id = getResolvedIdentity();
  if (!id || (!id.account && !id.email)) return;
  const name = id.displayNameHint || id.account || id.email || 'Admin';
  db.transaction(() => {
    const userId = db.prepare(`INSERT INTO users (display_name, email, account, role) VALUES (?, ?, ?, 'admin')`)
      .run(name, id.email, id.account).lastInsertRowid;
    db.prepare(`
      INSERT INTO audit_log (user_id, user_label, action, entity_type, entity_key, summary)
      VALUES (?, ?, 'user.bootstrap', 'user', ?, ?)
    `).run(userId, userLabel(name, id.account), String(userId), `${name} became the first admin (user list created)`);
  })();
}

export function userLabel(displayName: string, account: string | null): string {
  return account ? `${displayName} (${account})` : displayName;
}

function migrate(db: Database.Database): void {
  if (schemaVersion(db) < LEGACY_SCHEMA_VERSION) {
    runLegacyMigrations(db);
    db.pragma(`user_version = ${LEGACY_SCHEMA_VERSION}`);
  }

  const pending = MIGRATIONS
    .filter(m => m.version > schemaVersion(db))
    .sort((a, b) => a.version - b.version);
  for (const m of pending) {
    // foreign_keys can't change inside a transaction; legacy_alter_table stops RENAME from rewriting FKs in other
    // tables (see Migration 1). user_version is part of the transaction, so a failed step leaves no trace.
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    try {
      db.transaction(() => {
        m.up(db);
        db.pragma(`user_version = ${m.version}`);
      })();
    } finally {
      db.pragma('legacy_alter_table = OFF');
      db.pragma('foreign_keys = ON');
    }
  }
}

// Steps 1–6 predate PRAGMA user_version: each one detects from the stored DDL whether it is still needed.
function runLegacyMigrations(db: Database.Database): void {
  // Migration 1: Widen price_type CHECK constraint to include PrevPercent and PrevAbsolute.
  // Uses legacy_alter_table=ON to prevent SQLite 3.26.0+ from rewriting FK references
  // in price_list_entries when renaming price_lists (which would corrupt the FK).
  const plRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='price_lists'`
  ).get() as { sql: string } | undefined;

  if (plRow && !plRow.sql.includes('PrevPercent')) {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.exec(`
      ALTER TABLE price_lists RENAME TO _price_lists_old;
      CREATE TABLE price_lists (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        price_list_id TEXT NOT NULL UNIQUE,
        customer_ref_sap TEXT NOT NULL,
        sap_plant TEXT, effective TEXT NOT NULL, mailing_date TEXT NOT NULL,
        price_list_version TEXT NOT NULL, comments_about_changes TEXT,
        price_type TEXT NOT NULL CHECK (price_type IN ('Discount','Net Price','PrevPercent','PrevAbsolute')),
        discount_percent REAL,
        created_at TEXT DEFAULT (datetime('now'))
      );
      INSERT INTO price_lists SELECT * FROM _price_lists_old;
      DROP TABLE _price_lists_old;
      CREATE INDEX IF NOT EXISTS idx_price_lists_customer ON price_lists(customer_ref_sap);
    `);
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }

  // Migration 2: Fix price_list_entries FK if it was corrupted by a prior run of Migration 1
  // without legacy_alter_table=ON. SQLite 3.26.0+ rewrites the FK reference from
  // REFERENCES price_lists → REFERENCES _price_lists_old when the table is renamed,
  // which breaks all subsequent inserts with foreign_keys=ON once _price_lists_old is dropped.
  const pleRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='price_list_entries'`
  ).get() as { sql: string } | undefined;

  if (pleRow?.sql.includes('_price_lists_old')) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      ALTER TABLE price_list_entries RENAME TO _price_list_entries_old;
      CREATE TABLE price_list_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        price_list_id TEXT NOT NULL,
        product_type TEXT NOT NULL, rip_code TEXT NOT NULL,
        product_name TEXT NOT NULL, net_price REAL NOT NULL,
        currency TEXT NOT NULL, unit TEXT NOT NULL,
        FOREIGN KEY (price_list_id) REFERENCES price_lists(price_list_id)
      );
      INSERT INTO price_list_entries SELECT * FROM _price_list_entries_old;
      DROP TABLE _price_list_entries_old;
      CREATE INDEX IF NOT EXISTS idx_price_list_entries_pl ON price_list_entries(price_list_id);
    `);
    db.pragma('foreign_keys = ON');
  }

  // Migration 3: Add main_supply_region column to customers table.
  const custRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'`
  ).get() as { sql: string } | undefined;

  if (custRow && !custRow.sql.includes('main_supply_region')) {
    db.exec(`
      ALTER TABLE customers ADD COLUMN main_supply_region TEXT
        CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA'));
    `);
  }

  // Migration 4: Add is_deleted soft-delete flag to customers table.
  const custRow2 = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'`
  ).get() as { sql: string } | undefined;

  if (custRow2 && !custRow2.sql.includes('is_deleted')) {
    db.exec(`ALTER TABLE customers ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0;`);
  }

  // Migration 5: Relax customers.currency CHECK constraint to allow currencies beyond USD/EUR.
  // Detection: old schema has the two-value CHECK; new schema has none.
  const custRow3 = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='customers'`
  ).get() as { sql: string } | undefined;

  if (custRow3?.sql.includes("CHECK (currency IN ('USD','EUR'))")) {
    db.pragma('foreign_keys = OFF');
    db.exec(`
      ALTER TABLE customers RENAME TO _customers_old;
      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        zone TEXT, country TEXT, customer_type TEXT, comment_on_business_model TEXT,
        customer_ref_type_sap TEXT, customer_ref_sap TEXT NOT NULL UNIQUE,
        customer_short_name TEXT NOT NULL, customer_full_name TEXT NOT NULL,
        currency TEXT NOT NULL,
        packaging_version TEXT NOT NULL,
        price_list_managed_by TEXT, customer_spoc TEXT,
        effective TEXT, mailing_date TEXT,
        last_price_list_version TEXT, last_price_list_id TEXT,
        email_to_customer TEXT, email_internal_copy TEXT,
        email_pbp_copy TEXT, email_pbp_common TEXT,
        main_supply_region TEXT CHECK (main_supply_region IN ('ASIA','EUROPE','AMERICA')),
        is_deleted INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO customers SELECT * FROM _customers_old;
      DROP TABLE _customers_old;
    `);
    db.pragma('foreign_keys = ON');
  }

  // Migration 6: Add version_id to standard_epl and create standard_epl_versions.
  // Detection: standard_epl DDL lacks version_id.
  // Uses legacy_alter_table=ON for safety (no other tables FK into standard_epl, but consistent pattern).
  const eplRow = db.prepare(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='standard_epl'`
  ).get() as { sql: string } | undefined;

  if (eplRow && !eplRow.sql.includes('version_id')) {
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.exec(`
      ALTER TABLE standard_epl RENAME TO _standard_epl_old;
      CREATE TABLE standard_epl (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version_id INTEGER NOT NULL REFERENCES standard_epl_versions(version_id),
        currency TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
        product_type TEXT NOT NULL, rip_code TEXT NOT NULL,
        product_name TEXT NOT NULL, net_price REAL NOT NULL, unit TEXT NOT NULL,
        UNIQUE (version_id, currency, rip_code)
      );
      INSERT INTO standard_epl (id, version_id, currency, product_type, rip_code, product_name, net_price, unit)
        SELECT id, 1, currency, product_type, rip_code, product_name, net_price, unit FROM _standard_epl_old;
      DROP TABLE _standard_epl_old;
      CREATE INDEX IF NOT EXISTS idx_standard_epl_currency ON standard_epl(currency);
    `);
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    currentPath = null;
  }
}

export function getCurrentDbPath(): string | null {
  return currentPath;
}

export function getLastOpenError(): DbOpenError | null {
  return lastOpenError;
}

export function isOpen(): boolean {
  return db !== null;
}

export function getLatestPublishedEplVersionId(): number {
  if (!db) return 1;
  const row = db.prepare(
    `SELECT version_id FROM standard_epl_versions WHERE status='published'
     ORDER BY published_at DESC, version_id DESC LIMIT 1`
  ).get() as { version_id: number } | undefined;
  return row?.version_id ?? 1;
}
