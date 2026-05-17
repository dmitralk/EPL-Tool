import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, FileDown, Mail } from 'lucide-react';
import { api } from '../../lib/ipc';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Select } from '../../components/ui/select';
import { Badge } from '../../components/ui/badge';
import { ConfirmDialog, Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import { formatDate } from '../../lib/utils';
import type { PriceListHeader, Customer } from '../../../types';

const DEFAULT_SUBJECT = 'Price List — {customer} — {version}';
const DEFAULT_BODY = `Dear Customer,\n\nPlease find attached the updated price list for {customer_full}.\n\nEffective: {effective}\nVersion: {version}\n\nBest regards,`;

export function PriceListsScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [lists, setLists] = useState<PriceListHeader[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [search, setSearch] = useState('');
  const [showLatestOnly, setShowLatestOnly] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkWorking, setBulkWorking] = useState(false);
  const [composeOpen, setComposeOpen] = useState(false);
  const [emailSubject, setEmailSubject] = useState(DEFAULT_SUBJECT);
  const [emailBody, setEmailBody] = useState(DEFAULT_BODY);
  const selectAllRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function load() {
      const [l, c, savedSubject, savedBody] = await Promise.all([
        api.getPriceLists(),
        api.getCustomers(),
        api.getSetting('email_subject_template'),
        api.getSetting('email_body_template'),
      ]);
      setLists(l as PriceListHeader[]);
      setCustomers(c as Customer[]);
      if (savedSubject) setEmailSubject(savedSubject);
      if (savedBody) setEmailBody(savedBody);
    }
    load();
  }, []);

  const searched = lists.filter(pl => {
    if (filterCustomer && pl.customer_ref_sap !== filterCustomer) return false;
    if (search) {
      const s = search.toLowerCase();
      if (!pl.customer_short_name?.toLowerCase().includes(s) && !pl.price_list_id.toLowerCase().includes(s)) return false;
    }
    return true;
  });

  const filtered = showLatestOnly ? (() => {
    const latestByCustomer = new Map<string, PriceListHeader>();
    for (const pl of searched) {
      const existing = latestByCustomer.get(pl.customer_ref_sap);
      if (!existing) {
        latestByCustomer.set(pl.customer_ref_sap, pl);
      } else {
        const plDate = pl.effective ? new Date(pl.effective).getTime() : -Infinity;
        const existingDate = existing.effective ? new Date(existing.effective).getTime() : -Infinity;
        if (plDate > existingDate) latestByCustomer.set(pl.customer_ref_sap, pl);
      }
    }
    return [...latestByCustomer.values()];
  })() : searched;

  // Keep the select-all checkbox indeterminate state in sync
  useEffect(() => {
    if (selectAllRef.current) {
      selectAllRef.current.indeterminate = selected.size > 0 && selected.size < filtered.length;
    }
  }, [selected.size, filtered.length]);

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map(pl => pl.price_list_id)));
    }
  }

  async function handleDelete(id: string) {
    await api.deletePriceList(id);
    setLists(prev => prev.filter(p => p.price_list_id !== id));
    setSelected(prev => { const next = new Set(prev); next.delete(id); return next; });
    toast('Price list deleted', 'info');
  }

  async function handleExport(id: string) {
    const result = await api.exportXlsx(id);
    if (result.saved) toast('Exported successfully', 'success');
    else if (result.error) toast(`Export failed: ${result.error}`, 'error');
  }

  async function handleBulkExport() {
    setBulkWorking(true);
    const result = await api.exportXlsxBulk([...selected]);
    setBulkWorking(false);
    if ((result as any).canceled) return;
    const r = (result as any).results as { id: string; filename?: string; error?: string }[];
    const ok = r.filter(x => !x.error).length;
    const fail = r.filter(x => x.error).length;
    if (fail === 0) {
      toast(`Exported ${ok} file${ok !== 1 ? 's' : ''} to ${(result as any).folder}`, 'success');
    } else {
      toast(`${ok} exported, ${fail} failed`, 'error');
    }
  }

  async function handleSendEmails() {
    setComposeOpen(false);
    setBulkWorking(true);
    await Promise.all([
      api.setSetting('email_subject_template', emailSubject),
      api.setSetting('email_body_template', emailBody),
    ]);
    const result = await api.openMailBulk([...selected], emailSubject, emailBody);
    setBulkWorking(false);
    if ((result as any).canceled) return;
    const r = (result as any).results as { id: string; filename?: string; error?: string }[];
    const ok = r.filter(x => !x.error).length;
    const fail = r.filter(x => x.error).length;
    if (fail === 0) {
      toast(`Opened ${ok} email${ok !== 1 ? 's' : ''} with attachments`, 'success');
    } else {
      const isPermission = r.some(x => x.error && (x.error.includes('-1743') || x.error.includes('Not authorized')));
      const msg = isPermission
        ? 'Mail access denied. Go to System Settings → Privacy & Security → Automation → EPL Tool and enable Mail.'
        : `${ok} emails opened, ${fail} failed`;
      toast(msg, 'error');
    }
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Price Lists</h1>
          <p className="text-gray-500 text-sm mt-0.5">
            {showLatestOnly ? `${filtered.length} customers` : `${filtered.length} of ${lists.length} price lists`}
          </p>
        </div>
        <Button onClick={() => navigate('/price-lists/create')} className="gap-2">
          <Plus size={15} />
          New Price List
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Search customer or ID…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={filterCustomer}
          onChange={e => setFilterCustomer(e.target.value)}
          className="w-48"
          placeholder="All customers"
        >
          {customers.map(c => (
            <option key={c.customer_ref_sap} value={c.customer_ref_sap}>
              {c.customer_short_name}
            </option>
          ))}
        </Select>
        <button
          onClick={() => { setShowLatestOnly(v => !v); setSelected(new Set()); }}
          className={`ml-auto text-sm px-3 py-1.5 rounded-md border transition-colors whitespace-nowrap ${
            showLatestOnly
              ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
              : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
          }`}
        >
          {showLatestOnly ? 'Latest only' : 'View all'}
        </button>
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 mb-4 px-4 py-2.5 bg-blue-50 border border-blue-200 rounded-lg">
          <span className="text-sm font-medium text-blue-800">
            {selected.size} selected
          </span>
          <div className="flex gap-2 ml-auto">
            <Button
              size="sm"
              onClick={handleBulkExport}
              disabled={bulkWorking}
              className="gap-1.5"
            >
              <FileDown size={13} />
              {bulkWorking ? 'Working…' : `Export (${selected.size})`}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setComposeOpen(true)}
              disabled={bulkWorking}
              className="gap-1.5"
            >
              <Mail size={13} />
              {bulkWorking ? 'Working…' : `Email (${selected.size})`}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelected(new Set())}
              className="text-gray-500"
            >
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-lg border border-gray-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              <th className="px-4 py-3 w-10">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  className="rounded border-gray-300 cursor-pointer"
                  checked={filtered.length > 0 && selected.size === filtered.length}
                  onChange={toggleSelectAll}
                  disabled={filtered.length === 0}
                />
              </th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Customer</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Effective</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Mailing</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Version</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Type</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-10 text-gray-400">
                  No price lists found
                </td>
              </tr>
            ) : (
              filtered.map(pl => (
                <tr
                  key={pl.price_list_id}
                  className={`hover:bg-gray-50 transition-colors ${selected.has(pl.price_list_id) ? 'bg-blue-50/40' : ''}`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300 cursor-pointer"
                      checked={selected.has(pl.price_list_id)}
                      onChange={() => toggleSelect(pl.price_list_id)}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900">
                    {pl.customer_short_name ?? pl.customer_ref_sap}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.effective)}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDate(pl.mailing_date)}</td>
                  <td className="px-4 py-3 text-gray-600">{pl.price_list_version}</td>
                  <td className="px-4 py-3">
                    <Badge variant={pl.price_type === 'Discount' ? 'default' : 'secondary'}>
                      {pl.price_type === 'Discount' ? `${pl.discount_percent}% disc.` : 'Net Price'}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 justify-end">
                      <Button variant="ghost" size="sm" onClick={() => navigate(`/price-lists/${pl.price_list_id}`)}>
                        View
                      </Button>
                      <Button variant="outline" size="sm" onClick={() => handleExport(pl.price_list_id)}>
                        Export
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteId(pl.price_list_id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        Delete
                      </Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <ConfirmDialog
        open={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={() => deleteId && handleDelete(deleteId)}
        title="Delete Price List"
        description="This will permanently delete the price list and all its entries. This cannot be undone."
        confirmLabel="Delete"
      />

      <Dialog
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title={`Email ${selected.size} Price List${selected.size !== 1 ? 's' : ''}`}
      >
        <p className="text-xs text-gray-500 mb-3">
          Available placeholders: <code className="bg-gray-100 px-1 rounded">{'{customer}'}</code> <code className="bg-gray-100 px-1 rounded">{'{customer_full}'}</code> <code className="bg-gray-100 px-1 rounded">{'{version}'}</code> <code className="bg-gray-100 px-1 rounded">{'{effective}'}</code>
        </p>
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Subject</label>
            <input
              className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
              value={emailSubject}
              onChange={e => setEmailSubject(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs font-medium text-gray-600 mb-1 block">Body</label>
            <textarea
              className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y font-mono"
              rows={8}
              value={emailBody}
              onChange={e => setEmailBody(e.target.value)}
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 mb-4">Template is saved automatically when you send.</p>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setComposeOpen(false)}>Cancel</Button>
          <Button onClick={handleSendEmails} className="gap-1.5">
            <Mail size={13} /> Send {selected.size} Email{selected.size !== 1 ? 's' : ''}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
