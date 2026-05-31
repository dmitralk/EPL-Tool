import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/ipc';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Dialog } from '../../components/ui/dialog';
import { useToast } from '../../components/ui/toast';
import type { PackagingVersion } from '../../../types';

export function PackagingScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [versions, setVersions] = useState<PackagingVersion[]>([]);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [cloneFrom, setCloneFrom] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    const list = await api.listPackagingVersions();
    setVersions(list as PackagingVersion[]);
  }

  function closeDialog() {
    setNewOpen(false);
    setNewName('');
    setCloneFrom('');
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    const result = await api.createPackagingVersion(name, cloneFrom || undefined) as { ok: boolean; error?: string };
    setCreating(false);
    if (!result.ok) {
      toast(result.error ?? 'Failed to create version', 'error');
      return;
    }
    toast(`${name} created`, 'success');
    closeDialog();
    load();
  }

  async function handleDelete(v: PackagingVersion) {
    const result = await api.deletePackagingVersion(v.version) as { ok: boolean; error?: string };
    if (!result.ok) {
      toast(result.error ?? 'Cannot delete version', 'error');
      return;
    }
    toast(`${v.version} deleted`, 'success');
    setVersions(prev => prev.filter(x => x.version !== v.version));
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <div>
        <button
          onClick={() => navigate('/settings')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-block"
        >
          ← Settings
        </button>
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Packaging Versions</h1>
          <Button onClick={() => setNewOpen(true)}>+ New Version</Button>
        </div>
        <p className="text-sm text-gray-500 mt-1">
          Each customer is assigned one packaging version. Prices from that version appear in their exported price list.
        </p>
      </div>

      {versions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-400 text-sm">
            No packaging versions found. Import from Excel or create one manually.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {versions.map(v => (
            <Card key={v.version}>
              <CardContent className="flex items-center gap-4 py-4">
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-gray-900">{v.version}</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {v.currency && (
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-mono mr-2">
                        {v.currency}
                      </span>
                    )}
                    {v.row_count} row{v.row_count !== 1 ? 's' : ''} · {v.customer_count} customer{v.customer_count !== 1 ? 's' : ''}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/settings/packaging/${encodeURIComponent(v.version)}`)}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  onClick={() => handleDelete(v)}
                  disabled={v.customer_count > 0}
                  title={v.customer_count > 0 ? 'Reassign all customers to another version first' : undefined}
                >
                  Delete
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={newOpen} onClose={closeDialog} title="New Packaging Version">
        <div className="space-y-4 mb-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Version name</label>
            <Input
              autoFocus
              placeholder="e.g. GBP-Standard"
              value={newName}
              onChange={e => setNewName(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clone from (optional)</label>
            <select
              value={cloneFrom}
              onChange={e => setCloneFrom(e.target.value)}
              className="w-full text-sm border border-gray-300 rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">— Start empty —</option>
              {versions.map(v => (
                <option key={v.version} value={v.version}>{v.version}</option>
              ))}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Copies all rows from the selected version as a starting point.
            </p>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeDialog}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating || !newName.trim()}>
            {creating ? 'Creating…' : 'Create'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
