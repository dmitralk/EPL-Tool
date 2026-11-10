import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Archive, ArrowLeft, ChevronDown, ChevronRight, FileWarning, Loader2, RotateCcw } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useCan } from '../../lib/auth';
import { useSync } from '../../lib/syncState';
import { formatWhen } from '../../lib/sync';
import { useEditFlow } from '../../lib/editFlow';
import { ipcErrorMessage } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { ConflictAnalysis, ConflictCopyInfo, ConflictTableDiff, ReapplyResult, SyncPublishInfo } from '../../../types';

// Settings → Conflict copies (dev-plan Phase D, rescue tool): unpublished work kept when a publish was refused or the edit slot
// was lost, OneDrive conflict copies and copies kept on this PC. Review one: re-apply its price lists, see what was done in it
// and what differs; admins archive it when done. ?file=… keeps the copy under review when the screen reloads with new data.

const SOURCE_LABELS: Record<ConflictCopyInfo['source'], string> = {
  conflicts: 'EPL-Conflicts', onedrive: 'OneDrive copy', local: 'On this PC',
};

const PRICE_TYPES: Record<string, string> = {
  Discount: '% discount', 'Net Price': 'Net prices', PrevPercent: '% change', PrevAbsolute: 'Amount change',
};

const published = (p: SyncPublishInfo | null) =>
  !p ? 'unknown' : p.generation === 0 ? 'the original file (never published)'
    : `generation ${p.generation}${p.publishedBy ? ` (${p.publishedBy}${p.publishedAt ? `, ${formatWhen(p.publishedAt)}` : ''})` : ''}`;

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '—' : String(v));

export function ConflictCopiesScreen() {
  const [params, setParams] = useSearchParams();
  const file = params.get('file');
  return file
    ? <ConflictReview file={file} onBack={() => setParams({})} />
    : <ConflictList onReview={f => setParams({ file: f })} />;
}

function ConflictList({ onReview }: { onReview: (file: string) => void }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const can = useCan();
  const [copies, setCopies] = useState<ConflictCopyInfo[] | null>(null);
  const [archiving, setArchiving] = useState<ConflictCopyInfo | null>(null);

  const load = useCallback(() => {
    api.listConflictCopies().then(r => setCopies(r as ConflictCopyInfo[]), err => toast(ipcErrorMessage(err), 'error'));
  }, [toast]);
  useEffect(load, [load]);

  async function archive(c: ConflictCopyInfo) {
    try {
      await api.archiveConflictCopy(c.file);
      toast(`${c.name} moved to the archive`, 'success');
      load();
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/settings')} className="gap-1">
          <ArrowLeft size={15} /> Settings
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Conflict copies</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            Unpublished work kept when a publish was refused or the edit slot was lost, and OneDrive conflict copies. Nothing
            is lost: review a copy to re-apply its price lists and see what else was done in it.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Copy</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600 w-32">Saved</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Started from</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Last change in the copy</th>
              <th className="px-4 py-3 w-52" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {!copies && (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400"><Loader2 size={16} className="inline animate-spin" /></td></tr>
            )}
            {copies && copies.length === 0 && (
              <tr><td colSpan={5} className="text-center py-10 text-gray-400">No conflict copies — nothing to review.</td></tr>
            )}
            {copies?.map(c => (
              <tr key={c.file} className="align-top hover:bg-gray-50">
                <td className="px-4 py-2">
                  <div className="font-mono text-xs text-gray-800 break-all">{c.name}</div>
                  <Badge variant="secondary" className="mt-1">{SOURCE_LABELS[c.source]}</Badge>
                  {c.error && <div className="text-xs text-red-600 mt-1">{c.error}</div>}
                </td>
                <td className="px-4 py-2 text-gray-500 whitespace-nowrap">{formatWhen(c.modifiedAt)}</td>
                <td className="px-4 py-2 text-gray-600">{c.error ? '—' : published(c.basedOn)}</td>
                <td className="px-4 py-2 text-gray-600">
                  {c.lastChange ? <>{c.lastChange.summary}<div className="text-xs text-gray-400">{c.lastChange.by} · {formatWhen(c.lastChange.at)}</div></> : '—'}
                </td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  <Button size="sm" variant="outline" onClick={() => onReview(c.file)} disabled={!!c.error}>Review</Button>
                  {can.isAdmin && (
                    <Button size="sm" variant="ghost" className="ml-1 gap-1" onClick={() => setArchiving(c)}>
                      <Archive size={13} /> Archive
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!archiving} onClose={() => setArchiving(null)} onConfirm={() => { if (archiving) void archive(archiving); }}
        title="Archive this copy?" confirmLabel="Archive" variant="default"
        description={`${archiving?.name ?? ''} moves to the archive folder next to it and is no longer listed here. Nothing is deleted.`} />
    </div>
  );
}

function ConflictReview({ file, onBack }: { file: string; onBack: () => void }) {
  const { toast } = useToast();
  const can = useCan();
  const { status } = useSync();
  const flow = useEditFlow();
  const [data, setData] = useState<ConflictAnalysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<(ReapplyResult & { label: string })[] | null>(null);
  const [reapplying, setReapplying] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const writable = !!status?.writable;

  const load = useCallback(() => {
    api.analyzeConflictCopy(file).then(r => {
      setData(r as ConflictAnalysis);
      setError(null);
      setSelected(new Set());
    }, err => setError(ipcErrorMessage(err)));
  }, [file]);
  useEffect(load, [load, writable]);

  async function reapply() {
    setReapplying(true);
    const labels = new Map((data?.priceLists ?? []).map(l =>
      [l.price_list_id, `${l.customer_name ?? l.customer_ref_sap} · ${l.price_list_version} (effective ${l.effective})`]));
    try {
      const r = await api.reapplyPriceLists(file, [...selected]) as ReapplyResult[];
      setResults(r.map(x => ({ ...x, label: labels.get(x.price_list_id) ?? x.price_list_id })));
      const ok = r.filter(x => x.ok).length;
      toast(`${ok} price list${ok === 1 ? '' : 's'} re-applied${ok < r.length ? `, ${r.length - ok} not` : ''}. They are published with your other changes.`,
        ok === r.length ? 'success' : 'info');
      load();
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    } finally {
      setReapplying(false);
    }
  }

  async function archive() {
    try {
      await api.archiveConflictCopy(file);
      toast('The copy was moved to the archive', 'success');
      onBack();
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  const reapplyable = data?.priceLists.filter(l => !l.blocked) ?? [];
  const toggle = (id: string) => setSelected(s => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <div className="p-6 space-y-5 max-w-6xl">
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1 mt-1">
          <ArrowLeft size={15} /> Conflict copies
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><FileWarning size={20} className="text-amber-500" /> Review a conflict copy</h1>
          <p className="font-mono text-xs text-gray-500 mt-1 break-all">{file}</p>
          {data && (
            <p className="text-sm text-gray-600 mt-1">
              Started from {published(data.copy.basedOn)}; the shared database is now at {published(data.shared)}.
              Saved {formatWhen(data.copy.modifiedAt)} ({SOURCE_LABELS[data.copy.source]}).
            </p>
          )}
        </div>
        {can.isAdmin && data && (
          <Button variant="outline" className="gap-1" onClick={() => setArchiving(true)}><Archive size={14} /> Archive</Button>
        )}
      </div>

      {error && <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-800">{error}</div>}
      {!data && !error && <div className="text-gray-400 text-sm flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Comparing with the shared database…</div>}

      {data && (
        <>
          {/* Price lists */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-200">
              <div>
                <h2 className="font-semibold text-gray-900">Price lists only in this copy ({data.priceLists.length})</h2>
                <p className="text-xs text-gray-500">
                  Tick the ones to re-apply: they are created again in the shared database with the same checks as a new price
                  list (rights, same date and version). {data.priceListsOnlyInShared > 0 && `${data.priceListsOnlyInShared} price list${data.priceListsOnlyInShared === 1 ? ' is' : 's are'} only in the shared database (published after this copy was made, or deleted in it).`}
                </p>
              </div>
              {data.priceLists.length > 0 && (
                writable ? (
                  <Button onClick={reapply} disabled={!selected.size || reapplying} className="gap-1 shrink-0">
                    <RotateCcw size={14} /> {reapplying ? 'Re-applying…' : `Re-apply selected (${selected.size})`}
                  </Button>
                ) : status?.canStartEditing ? (
                  <Button variant="outline" onClick={flow.start} disabled={flow.running} className="shrink-0">Start editing to re-apply</Button>
                ) : (
                  <span className="text-xs text-gray-500 shrink-0">{can.readOnly ?? status?.startEditingBlocked}</span>
                )
              )}
            </div>
            {results && results.length > 0 && (
              <div className="px-4 py-2 border-b border-gray-100 bg-gray-50 text-xs space-y-0.5">
                {results.map(r => (
                  <div key={r.price_list_id} className={r.ok ? 'text-green-700' : 'text-red-700'}>
                    {r.ok ? '✓' : '✗'} {r.label}{r.error ? ` — ${r.error}` : ' — re-applied'}
                  </div>
                ))}
              </div>
            )}
            {data.priceLists.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Every price list of this copy is in the shared database.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200 text-gray-600">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <input type="checkbox" disabled={!writable || !reapplyable.length}
                        checked={!!reapplyable.length && reapplyable.every(l => selected.has(l.price_list_id))}
                        onChange={e => setSelected(e.target.checked ? new Set(reapplyable.map(l => l.price_list_id)) : new Set())} />
                    </th>
                    <th className="text-left px-3 py-2 font-medium">Customer</th>
                    <th className="text-left px-3 py-2 font-medium">Version</th>
                    <th className="text-left px-3 py-2 font-medium">Effective</th>
                    <th className="text-left px-3 py-2 font-medium">Mailing</th>
                    <th className="text-left px-3 py-2 font-medium">Pricing</th>
                    <th className="text-right px-3 py-2 font-medium">Products</th>
                    <th className="text-left px-3 py-2 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data.priceLists.map(l => (
                    <tr key={l.price_list_id} className="align-top">
                      <td className="px-3 py-2 text-center">
                        <input type="checkbox" disabled={!writable || !!l.blocked} checked={selected.has(l.price_list_id)}
                          onChange={() => toggle(l.price_list_id)} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-gray-900">{l.customer_name ?? l.customer_ref_sap}</div>
                        <div className="text-xs text-gray-400">{l.customer_ref_sap}</div>
                        {l.blocked && <div className="text-xs text-amber-700 mt-1">{l.blocked}</div>}
                      </td>
                      <td className="px-3 py-2 text-gray-700">{l.price_list_version}</td>
                      <td className="px-3 py-2 text-gray-700 whitespace-nowrap">{l.effective}</td>
                      <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{l.mailing_date}</td>
                      <td className="px-3 py-2 text-gray-500">{PRICE_TYPES[l.price_type] ?? l.price_type}</td>
                      <td className="px-3 py-2 text-right text-gray-700">{l.entries}</td>
                      <td className="px-3 py-2 text-gray-500 text-xs">{l.created_by ?? '—'}<div>{l.created_at ? formatWhen(`${l.created_at.replace(' ', 'T')}Z`) : ''}</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Activity */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">What was done in this copy ({data.activityCount})</h2>
              <p className="text-xs text-gray-500">
                Activity recorded in the copy that the shared database doesn't have. Redo by hand what still matters (price
                lists can be re-applied above).
                {data.activityCount > data.activity.length && ` Showing the last ${data.activity.length}.`}
              </p>
            </div>
            {data.activity.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400 text-center">Nothing — the shared database has every change of this copy.</p>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y divide-gray-100">
                  {data.activity.map((a, i) => (
                    <tr key={i} className="align-top">
                      <td className="px-4 py-2 text-gray-500 whitespace-nowrap w-32">{formatWhen(a.at)}</td>
                      <td className="px-4 py-2 text-gray-600 w-56 truncate max-w-[14rem]" title={a.by}>{a.by}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-400 w-36">{a.action}</td>
                      <td className="px-4 py-2 text-gray-900">{a.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* Differences */}
          <section className="bg-white rounded-lg border border-gray-200 shadow-sm">
            <div className="px-4 py-3 border-b border-gray-200">
              <h2 className="font-semibold text-gray-900">Other differences with the shared database</h2>
              <p className="text-xs text-gray-500">
                Rows that differ between this copy and the shared database. Either side may have changed them — compare with the
                activity above before redoing anything.
              </p>
            </div>
            {data.tables.length === 0
              ? <p className="px-4 py-6 text-sm text-gray-400 text-center">No other differences.</p>
              : <div className="divide-y divide-gray-100">{data.tables.map(t => <TableDiff key={t.table} diff={t} />)}</div>}
          </section>
        </>
      )}

      <ConfirmDialog open={archiving} onClose={() => setArchiving(false)} onConfirm={() => { void archive(); }}
        title="Archive this copy?" confirmLabel="Archive" variant="default"
        description="The copy moves to the archive folder next to it and is no longer listed. Nothing is deleted." />
    </div>
  );
}

function TableDiff({ diff }: { diff: ConflictTableDiff }) {
  const [open, setOpen] = useState(false);
  const more = (shown: number, total: number) => (total > shown ? <li className="text-gray-400">… and {total - shown} more</li> : null);
  return (
    <div className="px-4 py-2">
      <button className="flex items-center gap-2 text-sm w-full text-left" onClick={() => setOpen(o => !o)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span className="font-medium text-gray-900">{diff.label}</span>
        {diff.addedCount > 0 && <Badge variant="default">{diff.addedCount} only in the copy</Badge>}
        {diff.removedCount > 0 && <Badge variant="secondary">{diff.removedCount} only in the shared database</Badge>}
        {diff.changedCount > 0 && <Badge variant="outline">{diff.changedCount} different</Badge>}
      </button>
      {open && (
        <div className="mt-2 ml-6 space-y-3 text-xs">
          {diff.added.length > 0 && (
            <div>
              <div className="font-medium text-gray-700 mb-1">Only in the copy</div>
              <ul className="space-y-0.5 text-gray-600">{diff.added.map(r => <li key={r.key}>{r.label}</li>)}{more(diff.added.length, diff.addedCount)}</ul>
            </div>
          )}
          {diff.removed.length > 0 && (
            <div>
              <div className="font-medium text-gray-700 mb-1">Only in the shared database</div>
              <ul className="space-y-0.5 text-gray-600">{diff.removed.map(r => <li key={r.key}>{r.label}</li>)}{more(diff.removed.length, diff.removedCount)}</ul>
            </div>
          )}
          {diff.changed.length > 0 && (
            <div>
              <div className="font-medium text-gray-700 mb-1">Different</div>
              <table className="text-gray-600">
                <thead><tr className="text-gray-400"><th className="text-left pr-4 font-normal">Row</th><th className="text-left pr-4 font-normal">Field</th><th className="text-left pr-4 font-normal">In the copy</th><th className="text-left font-normal">In the shared database</th></tr></thead>
                <tbody>
                  {diff.changed.flatMap(c => c.fields.map((f, i) => (
                    <tr key={`${c.key}|${f.field}`} className="align-top">
                      <td className="pr-4 py-0.5">{i === 0 ? c.label : ''}</td>
                      <td className="pr-4 py-0.5 font-mono">{f.field}</td>
                      <td className="pr-4 py-0.5 break-all">{show(f.copy)}</td>
                      <td className="py-0.5 break-all">{show(f.shared)}</td>
                    </tr>
                  )))}
                  {diff.changedCount > diff.changed.length && <tr><td colSpan={4} className="text-gray-400">… and {diff.changedCount - diff.changed.length} more</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
