import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { PrefKey } from '../shared/prefs';
import type { AuditFilters, NewCustomerInput, PricingMode, SyncStatus, UserInput } from '../types';

const api = {
  // DB management
  dbSelectFile: () => ipcRenderer.invoke('db:select-file'),
  dbOpen: (filePath: string) => ipcRenderer.invoke('db:open', filePath),
  dbCreate: () => ipcRenderer.invoke('db:create'),
  dbGetPath: () => ipcRenderer.invoke('db:get-path'),
  dbOpenFolder: () => ipcRenderer.invoke('db:open-folder'),
  dbIsOpen: () => ipcRenderer.invoke('db:is-open'),
  dbLastOpenError: () => ipcRenderer.invoke('db:last-open-error'),

  // Shared database (read copy, refresh)
  getSyncStatus: () => ipcRenderer.invoke('sync:status'),
  selectSharedDb: () => ipcRenderer.invoke('sync:select-central'),
  connectShared: (centralPath: string) => ipcRenderer.invoke('sync:connect', centralPath),
  checkSync: () => ipcRenderer.invoke('sync:check'),
  applySyncUpdate: () => ipcRenderer.invoke('sync:apply-update'),
  refreshSync: () => ipcRenderer.invoke('sync:refresh'),
  startEditing: (opts?: { takeOver?: boolean }) => ipcRenderer.invoke('sync:start-editing', opts),
  cancelClaim: () => ipcRenderer.invoke('sync:cancel-claim'),
  waitForSlot: () => ipcRenderer.invoke('sync:wait-for-slot'),
  stopWaitingForSlot: () => ipcRenderer.invoke('sync:stop-waiting'),
  setSyncBusy: (busy: boolean) => ipcRenderer.invoke('sync:set-busy', busy),
  keepEditing: () => ipcRenderer.invoke('sync:keep-editing'),
  dismissSlotReleased: () => ipcRenderer.invoke('sync:dismiss-released'),
  publishNow: () => ipcRenderer.invoke('sync:publish'),
  finishEditing: () => ipcRenderer.invoke('sync:finish-editing'),
  recoverUnpublished: (action: 'resume' | 'publish' | 'discard', opts?: { takeOver?: boolean }) =>
    ipcRenderer.invoke('sync:recover', action, opts),
  dismissSyncConflict: () => ipcRenderer.invoke('sync:dismiss-conflict'),
  getSyncDetails: () => ipcRenderer.invoke('sync:details'),
  forceReleaseSlot: (slotId: string) => ipcRenderer.invoke('sync:force-release', slotId),
  onSyncStatus: (listener: (status: SyncStatus) => void) => {
    const wrapped = (_e: IpcRendererEvent, status: SyncStatus) => listener(status);
    ipcRenderer.on('sync:status', wrapped);
    return () => { ipcRenderer.removeListener('sync:status', wrapped); };
  },

  // Backups
  listBackups: () => ipcRenderer.invoke('backup:list'),
  createBackup: () => ipcRenderer.invoke('backup:create'),
  openBackupFolder: () => ipcRenderer.invoke('backup:open-folder'),
  restoreBackup: (backupPath: string) => ipcRenderer.invoke('backup:restore', backupPath),

  // Customers
  getCustomers: () => ipcRenderer.invoke('customers:list'),
  getCustomer: (ref: string) => ipcRenderer.invoke('customers:get', ref),
  createCustomer: (data: NewCustomerInput) => ipcRenderer.invoke('customers:create', data),
  updateCustomer: (ref: string, data: unknown) => ipcRenderer.invoke('customers:update', ref, data),
  setCustomerAccess: (ref: string, access: { pricing_mode: PricingMode; manager_ids: number[] }) =>
    ipcRenderer.invoke('customers:set-access', ref, access),
  softDeleteCustomer: (ref: string) => ipcRenderer.invoke('customers:soft-delete', ref),
  restoreCustomer: (ref: string) => ipcRenderer.invoke('customers:restore', ref),
  getDeletedCustomers: () => ipcRenderer.invoke('customers:list-deleted'),
  deleteCustomerPermanent: (ref: string) => ipcRenderer.invoke('customers:delete-permanent', ref),

  // Products
  getProducts: () => ipcRenderer.invoke('products:list'),
  createProduct: (data: unknown) => ipcRenderer.invoke('products:create', data),
  updateProduct: (id: number, data: unknown) => ipcRenderer.invoke('products:update', id, data),
  deleteProduct: (id: number) => ipcRenderer.invoke('products:delete', id),

  // Standard EPL
  getStandardEpl: (currency?: 'USD' | 'EUR', versionId?: number) => ipcRenderer.invoke('standard-epl:list', currency, versionId),
  getStandardEplCombined: (versionId?: number) => ipcRenderer.invoke('standard-epl:list-combined', versionId),
  updateStandardEplPrice: (id: number, price: number) => ipcRenderer.invoke('standard-epl:update-price', id, price),
  upsertStandardEpl: (data: unknown) => ipcRenderer.invoke('standard-epl:upsert', data),
  listStandardEplVersions: () => ipcRenderer.invoke('standard-epl:list-versions'),
  createStandardEplDraft: (params: unknown) => ipcRenderer.invoke('standard-epl:create-draft', params),
  publishStandardEplDraft: (params: unknown) => ipcRenderer.invoke('standard-epl:publish-draft', params),
  deleteStandardEplDraft: () => ipcRenderer.invoke('standard-epl:delete-draft'),
  updateStandardEplDraftMeta: (params: unknown) => ipcRenderer.invoke('standard-epl:update-draft-meta', params),
  deleteStandardEplRow: (params: unknown) => ipcRenderer.invoke('standard-epl:delete-row', params),

  // Packaging
  getPackaging: (version?: string) => ipcRenderer.invoke('packaging:list', version),
  listPackagingVersions: () => ipcRenderer.invoke('packaging:list-versions'),
  createPackagingVersion: (name: string, cloneFrom?: string) => ipcRenderer.invoke('packaging:create-version', name, cloneFrom),
  deletePackagingVersion: (version: string) => ipcRenderer.invoke('packaging:delete-version', version),
  addPackagingRow: (row: unknown) => ipcRenderer.invoke('packaging:add-row', row),
  updatePackagingRow: (id: number, fields: unknown) => ipcRenderer.invoke('packaging:update-row', id, fields),
  deletePackagingRow: (id: number) => ipcRenderer.invoke('packaging:delete-row', id),

  // Price lists
  getPriceLists: (filters?: { customer_ref_sap?: string; from?: string; to?: string }) =>
    ipcRenderer.invoke('price-lists:list', filters),
  getPriceList: (id: string) => ipcRenderer.invoke('price-lists:get', id),
  createPriceList: (data: unknown) => ipcRenderer.invoke('price-lists:create', data),
  deletePriceList: (id: string) => ipcRenderer.invoke('price-lists:delete', id),
  getPriceListStats: () => ipcRenderer.invoke('price-lists:stats'),

  // Export
  exportXlsx: (price_list_id: string) => ipcRenderer.invoke('export:xlsx', price_list_id),
  exportXlsxBulk: (ids: string[]) => ipcRenderer.invoke('export:xlsx-bulk', ids),
  openMailBulk: (ids: string[], subject: string, body: string) => ipcRenderer.invoke('export:open-mail-bulk', ids, subject, body),
  exportStandardEplXlsx: (versionId?: number) => ipcRenderer.invoke('export:standard-epl-xlsx', versionId),
  exportStandardEplMail: (versionId?: number) => ipcRenderer.invoke('export:standard-epl-mail', versionId),
  exportPackagingXlsx: (version: string) => ipcRenderer.invoke('export:packaging-xlsx', version),
  exportPackagingMail: (version: string) => ipcRenderer.invoke('export:packaging-mail', version),

  // Settings
  getAdminEmails: () => ipcRenderer.invoke('settings:get-admin-emails'),
  updateAdminEmail: (id: number, email: string) => ipcRenderer.invoke('settings:update-admin-email', id, email),
  createAdminEmail: (name: string, email: string) => ipcRenderer.invoke('settings:create-admin-email', name, email),
  deleteAdminEmail: (id: number) => ipcRenderer.invoke('settings:delete-admin-email', id),
  getUnits: () => ipcRenderer.invoke('settings:get-units'),
  createUnit: (name: string) => ipcRenderer.invoke('settings:create-unit', name),
  deleteUnit: (id: number) => ipcRenderer.invoke('settings:delete-unit', id),
  getLogo: () => ipcRenderer.invoke('settings:get-logo'),
  selectLogo: () => ipcRenderer.invoke('settings:select-logo'),

  // Identity, access and local (per-user) preferences
  whoami: () => ipcRenderer.invoke('auth:whoami'),
  getAuthState: () => ipcRenderer.invoke('auth:me'),
  startPreview: (userId: number) => ipcRenderer.invoke('auth:preview-start', userId),
  stopPreview: () => ipcRenderer.invoke('auth:preview-stop'),
  requestAccess: (kind?: 'access' | 'change') => ipcRenderer.invoke('auth:request-access', kind),
  getPref: (key: PrefKey) => ipcRenderer.invoke('prefs:get', key),
  setPref: (key: PrefKey, value: string) => ipcRenderer.invoke('prefs:set', key, value),

  // Users and activity log
  listUsers: () => ipcRenderer.invoke('users:list'),
  createUser: (data: UserInput) => ipcRenderer.invoke('users:create', data),
  updateUser: (id: number, data: UserInput) => ipcRenderer.invoke('users:update', id, data),
  listAudit: (filters?: AuditFilters) => ipcRenderer.invoke('audit:list', filters),
  exportAuditXlsx: (filters?: AuditFilters) => ipcRenderer.invoke('audit:export-xlsx', filters),

  // Conflict copies (rescue tool)
  listConflictCopies: () => ipcRenderer.invoke('conflicts:list'),
  analyzeConflictCopy: (file: string) => ipcRenderer.invoke('conflicts:analyze', file),
  reapplyPriceLists: (file: string, ids: string[]) => ipcRenderer.invoke('conflicts:reapply', file, ids),
  archiveConflictCopy: (file: string) => ipcRenderer.invoke('conflicts:archive', file),

  // Currencies
  getCurrencies: () => ipcRenderer.invoke('currencies:list'),
  createCurrency: (code: string) => ipcRenderer.invoke('currencies:create', code),
  deleteCurrency: (id: number) => ipcRenderer.invoke('currencies:delete', id),

  // Analysis
  getAnalysisRows: (comparisonVersionId?: number) => ipcRenderer.invoke('analysis:list-rows', comparisonVersionId),
  getFxRates: () => ipcRenderer.invoke('fx:list'),
  setDefaultFxRates: (rates: { currency_code: string; rate_to_usd: number }[]) => ipcRenderer.invoke('fx:set-defaults', rates),
  exportAnalysisXlsx: (payload: unknown) => ipcRenderer.invoke('analysis:export-xlsx', payload),

  // Email management
  listEmails: () => ipcRenderer.invoke('emails:list'),
  setEmailAssignments: (email: string, changes: unknown) => ipcRenderer.invoke('emails:set-assignments', email, changes),
  replaceEmail: (oldEmail: string, newEmail: string) => ipcRenderer.invoke('emails:replace', oldEmail, newEmail),
  removeEmail: (email: string) => ipcRenderer.invoke('emails:remove', email),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
