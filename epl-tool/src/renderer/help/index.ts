/* eslint-disable import/no-unresolved -- "?raw" imports are resolved by Vite (the text of each Markdown file) */
// Help topics, in display order. Add new topic files here; the id is used in links ("help:<id>", /help/<id>).
// Inline values such as {{CHECK_INTERVAL}} are filled in from the constants the code uses (values.ts), so Help can't
// contradict the app. help.test.ts checks every topic's placeholders and links.
import { fillHelpValues } from './values';
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
import editing from './12-editing.md?raw';
import conflictCopies from './13-conflict-copies.md?raw';
import installing from './14-installing.md?raw';
import rulesOfUse from './15-rules-of-use.md?raw';
import onboarding from './16-onboarding.md?raw';
import faq from './17-faq.md?raw';

export const HELP_TOPICS: { id: string; body: string }[] = [
  { id: 'getting-started', body: gettingStarted },
  { id: 'installing', body: installing },
  { id: 'shared-database', body: sharedDatabase },
  { id: 'editing', body: editing },
  { id: 'rules-of-use', body: rulesOfUse },
  { id: 'roles', body: roles },
  { id: 'pricing-modes', body: pricingModes },
  { id: 'price-lists', body: priceLists },
  { id: 'customers', body: customers },
  { id: 'emails', body: emails },
  { id: 'analysis-fx', body: analysisFx },
  { id: 'activity', body: activity },
  { id: 'backups', body: backups },
  { id: 'conflict-copies', body: conflictCopies },
  { id: 'onboarding', body: onboarding },
  { id: 'faq', body: faq },
  { id: 'whats-new', body: whatsNew },
].map(t => ({ ...t, body: fillHelpValues(t.body) }));
