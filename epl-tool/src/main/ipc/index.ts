import { registerCustomerHandlers } from './customers';
import { registerProductHandlers } from './products';
import { registerPriceListHandlers } from './priceLists';
import { registerStandardEplHandlers } from './standardEpl';
import { registerPackagingHandlers } from './packaging';
import { registerSettingsHandlers } from './settings';
import { registerExportHandlers } from './export';
import { registerMigrationHandlers } from './migration';

export function registerAllIpcHandlers() {
  registerCustomerHandlers();
  registerProductHandlers();
  registerPriceListHandlers();
  registerStandardEplHandlers();
  registerPackagingHandlers();
  registerSettingsHandlers();
  registerExportHandlers();
  registerMigrationHandlers();
}
