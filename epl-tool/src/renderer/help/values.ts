// Values for the Help topics. "{{NAME}}" inside a line is replaced by HELP_VALUES[NAME], filled in from the constants the
// code uses, so Help can't contradict the app. A line that is only "{{NAME}}" is a generated block (HELP_BLOCKS, rendered by
// the Help screen). Plain module (no "?raw" imports) so that help.test.ts can check the topics against it.
import {
  AUTO_PUBLISH_SECONDS, CHANGE_CHECK_SECONDS, IDLE_RELEASE_MINUTES, IDLE_WARNING_MINUTES, MIN_EDIT_APP_VERSION,
  SLOT_HEARTBEAT_SECONDS, SLOT_TAKEOVER_MINUTES, SLOT_WAIT_SECONDS, describeSeconds,
} from '../../shared/sync';

export const HELP_VALUES: Record<string, string> = {
  CHECK_INTERVAL: describeSeconds(CHANGE_CHECK_SECONDS),
  AUTO_PUBLISH_DELAY: describeSeconds(AUTO_PUBLISH_SECONDS),
  SLOT_WAIT: describeSeconds(SLOT_WAIT_SECONDS),
  HEARTBEAT: describeSeconds(SLOT_HEARTBEAT_SECONDS),
  TAKEOVER: describeSeconds(SLOT_TAKEOVER_MINUTES * 60),
  IDLE_RELEASE: describeSeconds(IDLE_RELEASE_MINUTES * 60),
  IDLE_WARNING: describeSeconds(IDLE_WARNING_MINUTES * 60),
  MIN_EDIT_VERSION: MIN_EDIT_APP_VERSION,
};

export const HELP_BLOCKS = ['ROLES', 'PERMISSION_MATRIX'] as const;
export type HelpBlock = (typeof HELP_BLOCKS)[number];

export const fillHelpValues = (body: string): string =>
  body.replace(/\{\{(\w+)\}\}/g, (token, name: string) => HELP_VALUES[name] ?? token);
