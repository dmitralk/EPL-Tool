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

  // Products
  getProducts: () => ipcRenderer.invoke('products:list'),
  createProduct: (data: unknown) => ipcRenderer.invoke('products:create', data),
  updateProduct: (id: number, data: unknown) => ipcRenderer.invoke('products:update', id, data),
  deleteProduct: (id: number) => ipcRenderer.invoke('products:delete', id),

  // Standard EPL
  getStandardEpl: (currency?: 'USD' | 'EUR') => ipcRenderer.invoke('standard-epl:list', currency),
  updateStandardEplPrice: (id: number, price: number) => ipcRenderer.invoke('standard-epl:update-price', id, price),

  // Packaging
  getPackaging: (version?: string) => ipcRenderer.invoke('packaging:list', version),
  updatePackagingPrice: (id: number, price: number) => ipcRenderer.invoke('packaging:update-price', id, price),

  // Price lists
  getPriceLists: (filters?: { customer_ref_sap?: string; from?: string; to?: string }) =>
    ipcRenderer.invoke('price-lists:list', filters),
  getPriceList: (id: string) => ipcRenderer.invoke('price-lists:get', id),
  createPriceList: (data: unknown) => ipcRenderer.invoke('price-lists:create', data),
  deletePriceList: (id: string) => ipcRenderer.invoke('price-lists:delete', id),
  getPriceListStats: () => ipcRenderer.invoke('price-lists:stats'),

  // Export
  exportXlsx: (price_list_id: string) => ipcRenderer.invoke('export:xlsx', price_list_id),
  openMailWithAttachment: (params: { filePath: string; to: string; subject: string; body: string }) =>
    ipcRenderer.invoke('export:open-mail-with-attachment', params),

  // Settings
  getSetting: (key: string) => ipcRenderer.invoke('settings:get', key),
  setSetting: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),
  getAdminEmails: () => ipcRenderer.invoke('settings:get-admin-emails'),
  updateAdminEmail: (id: number, email: string) => ipcRenderer.invoke('settings:update-admin-email', id, email),
  selectLogo: () => ipcRenderer.invoke('settings:select-logo'),

  // Migration
  migrationSelectFile: () => ipcRenderer.invoke('migration:select-file'),
  migrationImport: (filePath: string) => ipcRenderer.invoke('migration:import-excel', filePath),
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;
