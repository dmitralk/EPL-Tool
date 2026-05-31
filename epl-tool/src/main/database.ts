import Database from 'better-sqlite3';

let db: Database.Database | null = null;

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

CREATE TABLE IF NOT EXISTS standard_epl (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
  product_type TEXT NOT NULL, rip_code TEXT NOT NULL,
  product_name TEXT NOT NULL, net_price REAL NOT NULL, unit TEXT NOT NULL,
  UNIQUE (currency, rip_code)
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

CREATE INDEX IF NOT EXISTS idx_price_lists_customer ON price_lists(customer_ref_sap);
CREATE INDEX IF NOT EXISTS idx_price_list_entries_pl ON price_list_entries(price_list_id);
CREATE INDEX IF NOT EXISTS idx_standard_epl_currency ON standard_epl(currency);
`;

const SEED_SQL = `
INSERT OR IGNORE INTO units (name) VALUES ('100 KG'), ('100 L');
INSERT OR IGNORE INTO currencies (code, is_main) VALUES ('USD', 1), ('EUR', 1);
`;

export function openDatabase(filePath: string): void {
  db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  db.exec(SEED_SQL);
  migrateIfNeeded(db);
}

function migrateIfNeeded(db: Database.Database): void {
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
}

export function getDb(): Database.Database {
  if (!db) throw new Error('Database not opened');
  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function isOpen(): boolean {
  return db !== null;
}
