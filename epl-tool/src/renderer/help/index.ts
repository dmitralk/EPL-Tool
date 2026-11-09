/* eslint-disable import/no-unresolved -- "?raw" imports are resolved by Vite (the text of each Markdown file) */
// Help topics, in display order. Add new topic files here; the id is used in links ("help:<id>", /help/<id>).
// Inline values such as {{CHECK_INTERVAL}} are filled in from the constants the code uses, so Help can't contradict the app.
import { AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, describeSeconds } from '../../shared/sync';
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
import sharedDatabase from './11-shared-database.md?raw';

const VALUES: Record<string, string> = {
  CHECK_INTERVAL: describeSeconds(CHANGE_CHECK_SECONDS),
  AUTO_PUBLISH_DELAY: describeSeconds(AUTO_PUBLISH_SECONDS),
};

const fill = (body: string) => body.replace(/\{\{(\w+)\}\}/g, (token, name: string) => VALUES[name] ?? token);

export const HELP_TOPICS: { id: string; body: string }[] = [
  { id: 'getting-started', body: gettingStarted },
  { id: 'shared-database', body: sharedDatabase },
  { id: 'roles', body: roles },
  { id: 'pricing-modes', body: pricingModes },
  { id: 'price-lists', body: priceLists },
  { id: 'customers', body: customers },
  { id: 'emails', body: emails },
  { id: 'analysis-fx', body: analysisFx },
  { id: 'activity', body: activity },
  { id: 'backups', body: backups },
  { id: 'whats-new', body: whatsNew },
].map(t => ({ ...t, body: fill(t.body) }));
