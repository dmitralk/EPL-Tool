import Database from 'better-sqlite3';

let db: Database.Database | null = null;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  zone TEXT, country TEXT, customer_type TEXT, comment_on_business_model TEXT,
  customer_ref_type_sap TEXT, customer_ref_sap TEXT NOT NULL UNIQUE,
  customer_short_name TEXT NOT NULL, customer_full_name TEXT NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','EUR')),
  packaging_version TEXT NOT NULL,
  price_list_managed_by TEXT, customer_spoc TEXT,
  effective TEXT, mailing_date TEXT,
  last_price_list_version TEXT, last_price_list_id TEXT,
  email_to_customer TEXT, email_internal_copy TEXT,
  email_pbp_copy TEXT, email_pbp_common TEXT
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
  price_type TEXT NOT NULL CHECK (price_type IN ('Discount','Net Price')),
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
`;

export function openDatabase(filePath: string): void {
  db = new Database(filePath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA_SQL);
  db.exec(SEED_SQL);
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
