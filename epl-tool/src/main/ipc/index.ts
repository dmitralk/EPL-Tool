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

export function registerAllIpcHandlers() {
  registerAuthHandlers();
  registerPrefsHandlers();
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
