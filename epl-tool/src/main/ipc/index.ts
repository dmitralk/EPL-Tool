import { registerCustomerHandlers } from './customers';
import { registerProductHandlers } from './products';
import { registerPriceListHandlers } from './priceLists';
import { registerStandardEplHandlers } from './standardEpl';
import { registerPackagingHandlers } from './packaging';
import { registerSettingsHandlers } from './settings';
import { registerExportHandlers } from './export';
import { registerCurrencyHandlers } from './currencies';
import { registerAnalysisHandlers } from './analysis';
import { registerEmailHandlers } from './emails';
import { registerBackupHandlers } from './backup';
import { registerAuthHandlers } from './auth';
import { registerPrefsHandlers } from './prefs';
import { registerUserHandlers } from './users';
import { registerAuditHandlers } from './audit';
import { registerSyncHandlers } from './sync';
import { registerConflictHandlers } from './conflicts';

export function registerAllIpcHandlers() {
  registerAuthHandlers();
  registerSyncHandlers();
  registerConflictHandlers();
  registerPrefsHandlers();
  registerUserHandlers();
  registerAuditHandlers();
  registerCustomerHandlers();
  registerProductHandlers();
  registerPriceListHandlers();
  registerStandardEplHandlers();
  registerPackagingHandlers();
  registerSettingsHandlers();
  registerExportHandlers();
  registerCurrencyHandlers();
  registerAnalysisHandlers();
  registerEmailHandlers();
  registerBackupHandlers();
}
