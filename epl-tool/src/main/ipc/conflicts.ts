import { getDb } from '../database';
import { getActor } from '../currentUser';
import { getSharedStore, refreshConflictCopies, waitForPublish } from '../sync/sync';
import { analyzeConflictCopy, archiveConflictCopy, listConflictCopies, reapplyPriceLists } from '../sync/rescue';
import { actor, handle, requireWritable } from './guard';

// Conflict copies (Phase D rescue tool, Settings → Conflict copies): everybody can review them; re-applying price lists is
// creating them (editor, edit mode, per-customer rule and duplicate guard per list); admins archive reviewed copies.

function store() {
  const s = getSharedStore();
  if (!s) throw new Error('Conflict copies exist only for a shared database.');
  return s;
}

export function registerConflictHandlers() {
  handle('conflicts:list', 'viewer', async () => {
    const s = getSharedStore();
    return s ? listConflictCopies(s) : [];
  });

  handle('conflicts:analyze', 'viewer', (_e, file: string) => analyzeConflictCopy(store(), String(file ?? ''), getDb(), getActor()));

  // One result per price list ({ ok } or the refusal), so the others are still re-applied.
  handle('conflicts:reapply', 'editor', (_e, file: string, ids: string[]) =>
    reapplyPriceLists(store(), String(file ?? ''), ids, getDb, actor, async () => {
      // The copy was read meanwhile: changes wait for a publish in progress, and must still be allowed.
      const publishing = waitForPublish();
      if (publishing) await publishing;
      requireWritable(getActor());
    }));

  // Moving a file in the shared folder doesn't change the database: allowed in read mode too.
  handle('conflicts:archive', 'admin', async (_e, file: string) => {
    const archivedTo = await archiveConflictCopy(store(), String(file ?? ''));
    await refreshConflictCopies();
    return { ok: true, archivedTo };
  }, { writes: false });
}
