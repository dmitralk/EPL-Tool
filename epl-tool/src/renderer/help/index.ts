/* eslint-disable import/no-unresolved -- "?raw" imports are resolved by Vite (the text of each Markdown file) */
// Help topics, in display order. Add new topic files here; the id is used in links ("help:<id>", /help/<id>).
import gettingStarted from './01-getting-started.md?raw';
import roles from './02-roles.md?raw';
import pricingModes from './03-pricing-modes.md?raw';
import priceLists from './04-price-lists.md?raw';
import customers from './05-customers.md?raw';
import emails from './06-emails.md?raw';
import analysisFx from './07-analysis-fx.md?raw';
import activity from './08-activity.md?raw';
import backups from './09-backups.md?raw';
import whatsNew from './10-whats-new.md?raw';

export const HELP_TOPICS: { id: string; body: string }[] = [
  { id: 'getting-started', body: gettingStarted },
  { id: 'roles', body: roles },
  { id: 'pricing-modes', body: pricingModes },
  { id: 'price-lists', body: priceLists },
  { id: 'customers', body: customers },
  { id: 'emails', body: emails },
  { id: 'analysis-fx', body: analysisFx },
  { id: 'activity', body: activity },
  { id: 'backups', body: backups },
  { id: 'whats-new', body: whatsNew },
];
