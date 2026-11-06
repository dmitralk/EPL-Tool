// Per-user preferences kept in the local settings.json (never in the shared database).
export const PREF_KEYS = ['emailSubjectTemplate', 'emailBodyTemplate'] as const;

export type PrefKey = typeof PREF_KEYS[number];

export const MAX_PREF_LENGTH = 20_000;

export function isPrefKey(key: unknown): key is PrefKey {
  return typeof key === 'string' && (PREF_KEYS as readonly string[]).includes(key);
}
