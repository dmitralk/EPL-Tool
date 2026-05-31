import { contextBridge, ipcRenderer } from 'electron';

const api = {
  // DB management
  dbSelectFile: () => ipcRenderer.invoke('db:select-file'),
  dbOpen: (filePath: string) => ipcRenderer.invoke('db:open', filePath),
  dbCreate: () => ipcRenderer.invoke('db:create'),
  dbGetPath: () => ipcRenderer.invoke('db:get-path'),
  dbIsOpen: () => ipcRenderer.invoke('db:is-open'),

  // Customers
  getCustomers: () => ipcRenderer.invoke('customers:list'),
  getCustomer: (ref: string) => ipcRenderer.invoke('customers:get', ref),
  createCustomer: (data: unknown) => ipcRenderer.invoke('customers:create', data),
  updateCustomer: (ref: string, data: unknown) => ipcRenderer.invoke('customers:update', ref, data),
  deleteCustomer: (ref: string) => ipcRenderer.invoke('customers:delete', ref),
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
  getStandardEpl: (currency?: 'USD' | 'EUR') => ipcRenderer.invoke('standard-epl:list', currency),
  getStandardEplCombined: () => ipcRenderer.invoke('standard-epl:list-combined'),
  updateStandardEplPrice: (id: number, price: number) => ipcRenderer.invoke('standard-epl:update-price', id, price),
  upsertStandardEpl: (data: unknown) => ipcRenderer.invoke('standard-epl:upsert', data),

  // Packaging
  getPackaging: (version?: string) => ipcRenderer.invoke('packaging:list', version),
  updatePackagingPrice: (id: number, price: number) => ipcRenderer.invoke('packaging:update-price', id, price),
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
  openMailWithAttachment: (params: { filePath: string; to: string; subject: string; body: string }) =>
    ipcRenderer.invoke('export:open-mail-with-attachment', params),
  openMailBulk: (ids: string[], subject: string, body: string) => ipcRenderer.invoke('export:open-mail-bulk', ids, subject, body),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getAdminEmails: () => ipcRenderer.invoke('settings:get-admin-emails'),
  updateAdminEmail: (id: number, email: string) => ipcRenderer.invoke('settings:update-admin-email', id, email),
  getUnits: () => ipcRenderer.invoke('settings:get-units'),
  createUnit: (name: string) => ipcRenderer.invoke('settings:create-unit', name),
  deleteUnit: (id: number) => ipcRenderer.invoke('settings:delete-unit', id),
  selectLogo: () => ipcRenderer.invoke('settings:select-logo'),

  // Currencies
  getCurrencies: () => ipcRenderer.invoke('currencies:list'),
  createCurrency: (code: string) => ipcRenderer.invoke('currencies:create', code),
  deleteCurrency: (id: number) => ipcRenderer.invoke('currencies:delete', id),

  // Migration
  migrationSelectFile: () => ipcRenderer.invoke('migration:select-file'),
  migrationPreview: (filePath: string) => ipcRenderer.invoke('migration:preview-excel', filePath),
  migrationImport: (filePath: string, options?: unknown) => ipcRenderer.invoke('migration:import-excel', filePath, options),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
