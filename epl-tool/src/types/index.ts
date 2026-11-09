export type Role = 'admin' | 'user' | 'viewer';

// Who may change a customer's price lists, emails and master data (access-rights study §3.1).
export type PricingMode = 'open' | 'pbp' | 'managed';

export interface Customer {
  id: number;
  zone: string | null;
  country: string | null;
  customer_type: string | null;
  comment_on_business_model: string | null;
  customer_ref_type_sap: string | null;
  customer_ref_sap: string;
  customer_short_name: string;
  customer_full_name: string;
  currency: string;
  packaging_version: string;
  customer_spoc: string | null;
  effective: string | null;
  mailing_date: string | null;
  last_price_list_version: string | null;
  last_price_list_id: string | null;
  email_to_customer: string | null;
  email_internal_copy: string | null;
  email_pbp_copy: string | null;
  email_pbp_common: string | null;
  main_supply_region: 'ASIA' | 'EUROPE' | 'AMERICA' | null;
  is_deleted: 0 | 1;
  pricing_mode: PricingMode;
  manager_ids: number[];      // customer_managers, filled by the customers:* handlers
  manager_names: string[];
}

export type NewCustomerInput = Partial<Omit<Customer, 'id' | 'is_deleted' | 'manager_ids' | 'manager_names'>> & {
  customer_ref_sap: string;
  manager_ids?: number[];
};

export interface AppUser {
  id: number;
  display_name: string;
  email: string | null;
  account: string | null;
  role: Role;
  is_active: 0 | 1;
  created_at: string;
}

export interface UserInput {
  display_name?: string;
  email?: string | null;
  account?: string | null;
  role?: Role;
  is_active?: 0 | 1;
}

export interface AuthState {
  identity: Identity;
  dbOpen: boolean;
  realUser: AppUser | null;        // the person at the keyboard (may be inactive)
  user: AppUser | null;            // effective active user: the previewed user while an admin previews
  previewing: boolean;
  managedCustomerRefs: string[];   // customers the effective user manages
  admins: { display_name: string; email: string | null }[];  // active admins, shown as contacts
}

export interface AuditEntry {
  id: number;
  at: string;                      // ISO UTC
  user_id: number | null;
  user_label: string;
  action: string;
  entity_type: string | null;
  entity_key: string | null;
  customer_ref_sap: string | null;
  summary: string;
  details: string | null;          // JSON
}

export interface AuditFilters {
  userId?: number;
  action?: string;                 // exact action or a prefix ending with '.' (e.g. 'customer.')
  customerRef?: string;
  from?: string;                   // YYYY-MM-DD, inclusive
  to?: string;                     // YYYY-MM-DD, inclusive
  search?: string;
  limit?: number;
}

export interface AuditListResult {
  entries: AuditEntry[];
  total: number;
  users: { user_id: number | null; user_label: string }[];
  actions: string[];
}

export interface Product {
  id: number;
  plant: string | null;
  product_type: string;
  rip_code: string;
  product_name: string;
}

export interface StandardEplRow {
  id: number;
  version_id: number;
  currency: 'USD' | 'EUR';
  product_type: string;
  rip_code: string;
  product_name: string;
  net_price: number;
  unit: string;
}

export interface StandardEplVersion {
  version_id: number;
  version_name: string;
  status: 'draft' | 'published';
  effective_from: string | null;
  notes: string | null;
  created_at: string;
  published_at: string | null;
  row_count?: number;
}

export interface PackagingRow {
  id: number;
  packaging_version: string;
  product_type: string;
  packaging_name: string;
  price: number | null;
  currency: string;
  unit: string | null;
  sort_order: number;
}

export interface PriceListHeader {
  id: number;
  price_list_id: string;
  customer_ref_sap: string;
  customer_short_name?: string;
  sap_plant: string | null;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  comments_about_changes: string | null;
  price_type: 'Discount' | 'Net Price' | 'PrevPercent' | 'PrevAbsolute';
  discount_percent: number | null;
  created_at?: string;
  created_by_user_id?: number | null;
  created_by_name?: string | null;   // null for lists created before v0.6
  pricing_mode?: PricingMode;        // the customer's, for delete gating
  manager_ids?: number[];
  manager_names?: string[];
}

export interface PriceListEntry {
  id: number;
  price_list_id: string;
  product_type: string;
  rip_code: string;
  product_name: string;
  net_price: number;
  currency: string;
  unit: string;
}

export interface PriceListFull extends PriceListHeader {
  entries: PriceListEntry[];
}

export interface Unit {
  id: number;
  name: string;
}

export interface AdminEmail {
  id: number;
  email_name: string;
  email: string;
}

// One address found in customers' To / Internal email fields, with every customer using it.
export interface EmailUsage {
  email: string;
  customers: EmailCustomerLink[];
}

export interface EmailCustomerLink {
  customer_ref_sap: string;
  customer_short_name: string;
  is_deleted: boolean;
  to: boolean;        // present in email_to_customer
  internal: boolean;  // present in email_internal_copy
  pricing_mode: PricingMode;
  manager_ids: number[];
  manager_names: string[];
}

export interface EmailBulkResult {
  ok: boolean;
  error?: string;
  updated?: number;
  skipped?: { customer_ref_sap: string; customer_short_name: string }[];  // not allowed for this user
}

export interface EmailAssignmentChange {
  customer_ref_sap: string;
  to: boolean;
  internal: boolean;
}

export interface BackupInfo {
  name: string;
  path: string;
  size: number;
  created_at: string;
  pre_restore: boolean;  // raw copy taken just before a restore
}

export interface BackupStatus {
  at: string;
  path?: string;
  error?: string;
}

export interface BackupListResult {
  folder: string | null;
  backups: BackupInfo[];
  last: BackupStatus | null;
}

export interface DbOpenError {
  path: string;
  message: string;
  corrupt: boolean;
}

export interface CreatePriceListInput {
  customer_ref_sap: string;
  sap_plant: string;
  effective: string;
  mailing_date: string;
  price_list_version: string;
  comments_about_changes: string;
  price_type: 'Discount' | 'Net Price' | 'PrevPercent' | 'PrevAbsolute';
  discount_percent: number | null;
  entries: Omit<PriceListEntry, 'id' | 'price_list_id'>[];
}

export interface CombinedEplRow {
  id: number;
  rip_code: string;
  product_type: string;
  product_name: string;
  plant: string | null;
  usd_id: number | null;
  usd_price: number | null;
  usd_unit: string | null;
  eur_id: number | null;
  eur_price: number | null;
  eur_unit: string | null;
}

export interface DbOpenResult {
  ok: boolean;
  error?: string;
}

// Who is running the app, as reported by Windows (auth:whoami). Not yet matched against a user list.
export interface Identity {
  account: string | null;           // Windows account, e.g. J0123456
  email: string | null;             // company email (lower case)
  emailSource: 'upn' | 'onedrive' | 'override' | null;
  displayNameHint: string;          // derived from the email; the user list holds the real name
  overridden: boolean;              // development-only EPL_DEV_ACCOUNT / EPL_DEV_EMAIL in use
}

export interface LogoInfo {
  dataUrl: string | null;           // logo stored in the database
  legacyPath: string | null;        // old per-PC file path, only reported when no logo is stored yet
}

// Shared database (Phase C, multi-user study §5): what the app is connected to and what the open copy is.
export interface SyncPublishInfo {
  generation: number;
  publishedBy: string | null;
  publishedAt: string | null;       // ISO UTC
}

// A person in the edit slot (Phase D): the holder, or an inactive session that can be taken over.
export interface SlotPerson {
  user: string;
  account: string | null;
  machine: string;
  since: string;                    // when they claimed the slot (ISO UTC)
  lastChangeAt: string | null;      // their last change
  heartbeatAt: string;              // last sign of life
  mine: boolean;
}

export interface SyncStatus {
  mode: 'none' | 'local' | 'shared';
  phase: 'connecting' | 'read' | 'edit' | null;  // shared mode only
  path: string | null;              // the local database, or the central database of the shared folder
  openId: number;                   // changes whenever another copy is opened: screens reload their data
  writable: boolean;                // changes allowed (local mode, or editing)
  writeBlock: 'read' | 'offline' | 'update' | null;
  data: (SyncPublishInfo & { copiedAt: string | null; fileTime: string | null }) | null;  // the open copy
  offline: { since: string; reason: string } | null;
  syncing: SyncPublishInfo | null;  // newer data announced by the manifest, not yet on this PC
  pendingUpdate: SyncPublishInfo | null;  // newer data downloaded, waiting to be applied
  newerApp: { schemaVersion: number; minAppVersion: string | null } | null;  // update EPL Tool to edit
  centralDamaged: boolean;          // the shared file failed the integrity check (last good copy in use)
  conflictCopies: string[];         // OneDrive conflict copies next to the central database
  lastCheckAt: string | null;
  error: string | null;
  canStartEditing: boolean;
  startEditingBlocked: string | null;  // why Start editing is not possible right now
  edit: {
    since: string;
    dirty: boolean;                 // changes not yet published
    publishing: boolean;
    lastPublishedAt: string | null;
    lastPublishedGeneration: number | null;
    nextPublishAt: string | null;
    error: string | null;
    centralChanged: string | null;  // someone else published meanwhile: the next publish will be refused
  } | null;
  conflict: { savedTo: string | null; at: string; message: string } | null;  // last refused publish
  recovery: { since: string; changedAt: string | null } | null;  // unpublished changes from a previous run
  slot: {
    holder: SlotPerson | null;      // who is editing right now (as seen at the last check)
    claimingUntil: string | null;   // my claim is in its waiting window until then
  };
  legacySuggestion: { path: string } | null;  // v0.6 database in a synced folder: offer to connect as shared
}

export type SelectLogoResult = { ok: true; dataUrl: string } | { ok: false; error: string } | null;

export interface Currency {
  id: number;
  code: string;
  is_main: 0 | 1;
}

export interface PackagingVersion {
  version: string;
  currency: string;
  row_count: number;
  customer_count: number;
}

export interface FxRate {
  currency_code: string;
  rate_to_usd: number;
}

// One row per (price list entry) across all active customers, joined with the
// standard EPL price (USD + EUR) for the chosen comparison version.
// Read-only analytical shape — see Analysis screen.
export interface AnalysisRow {
  price_list_id: string;
  price_list_version: string;
  effective: string | null;
  mailing_date: string | null;
  price_type: string;
  discount_percent: number | null;
  created_at: string | null;
  customer_ref_sap: string;
  customer_short_name: string;
  customer_full_name: string;
  main_supply_region: 'ASIA' | 'EUROPE' | 'AMERICA' | null;
  customer_type: string | null;
  customer_ref_type_sap: string | null;
  country: string | null;
  rip_code: string;
  product_type: string;
  product_name: string;
  net_price: number;
  currency: string;
  unit: string;
  epl_usd_price: number | null;
  epl_eur_price: number | null;
  is_latest: boolean;
  // Reserved for the future profitability feature (cost + margin columns).
  cost?: number | null;
  margin?: number | null;
}
