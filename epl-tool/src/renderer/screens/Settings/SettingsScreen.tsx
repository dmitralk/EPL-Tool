import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, Plus, Trash2, Users } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useCan } from '../../lib/auth';
import { ipcErrorMessage } from '../../lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input, Label } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { ConfirmDialog, Dialog } from '../../components/ui/dialog';
import { BackupPanel } from '../../components/BackupPanel';
import { AdminOnlyNote } from '../../components/LockBadge';
import type { AdminEmail, LogoInfo, SelectLogoResult, Unit } from '../../../types';

export function SettingsScreen() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const can = useCan();
  const admin = can.referenceData;
  const [dbOpen, setDbOpen] = useState(true);
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [logo, setLogo] = useState<LogoInfo>({ dataUrl: null, legacyPath: null });
  const [adminEmails, setAdminEmails] = useState<AdminEmail[]>([]);
  const [editingEmail, setEditingEmail] = useState<{ id: number | null; name: string; value: string } | null>(null);
  const [removeEmail, setRemoveEmail] = useState<AdminEmail | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [newUnit, setNewUnit] = useState('');
  const [addingUnit, setAddingUnit] = useState(false);

  useEffect(() => {
    async function load() {
      const [open, path] = await Promise.all([api.dbIsOpen(), api.dbGetPath()]);
      setDbOpen(Boolean(open));
      setDbPath(path);
      if (!open) return;
      const [logoInfo, emails, unitList] = await Promise.all([
        api.getLogo(),
        api.getAdminEmails(),
        api.getUnits(),
      ]);
      setLogo(logoInfo as LogoInfo);
      setAdminEmails(emails as AdminEmail[]);
      setUnits(unitList as Unit[]);
    }
    load();
  }, []);

  async function run(action: () => Promise<unknown>, success: string): Promise<boolean> {
    try {
      await action();
      toast(success, 'success');
      return true;
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
      return false;
    }
  }

  async function handleSelectLogo() {
    try {
      const result = await api.selectLogo() as SelectLogoResult;
      if (!result) return;
      if (result.ok) {
        setLogo({ dataUrl: result.dataUrl, legacyPath: null });
        toast('Logo updated', 'success');
      } else {
        toast(result.error, 'error');
      }
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    }
  }

  async function handleSaveEmail() {
    if (!editingEmail) return;
    const { id, name, value } = editingEmail;
    const ok = await run(async () => {
      if (id === null) {
        const created = await api.createAdminEmail(name, value) as AdminEmail;
        setAdminEmails(prev => [...prev, created].sort((a, b) => a.email_name.localeCompare(b.email_name)));
      } else {
        await api.updateAdminEmail(id, value);
        setAdminEmails(prev => prev.map(e => e.id === id ? { ...e, email: value.trim() } : e));
      }
    }, id === null ? 'PBP email added' : 'Email updated');
    if (ok) setEditingEmail(null);
  }

  async function handleRemoveEmail(e: AdminEmail) {
    if (await run(() => api.deleteAdminEmail(e.id), 'PBP email removed')) {
      setAdminEmails(prev => prev.filter(x => x.id !== e.id));
    }
  }

  async function handleAddUnit() {
    const name = newUnit.trim();
    if (!name) return;
    try {
      const created = await api.createUnit(name);
      setUnits(prev => [...prev, created as Unit].sort((a, b) => a.name.localeCompare(b.name)));
      setNewUnit('');
      setAddingUnit(false);
      toast('Unit added', 'success');
    } catch (err) {
      const msg = ipcErrorMessage(err);
      toast(/UNIQUE/i.test(msg) ? 'Unit already exists' : msg, 'error');
    }
  }

  async function handleDeleteUnit(id: number) {
    if (await run(() => api.deleteUnit(id), 'Unit deleted')) setUnits(prev => prev.filter(u => u.id !== id));
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {!dbOpen && (
        <div className="flex items-center justify-between gap-4 px-4 py-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-800">
          <span>No database is open. Open or create one first.</span>
          <Button size="sm" onClick={() => navigate('/setup')}>Open Database</Button>
        </div>
      )}

      {/* Database */}
      <Card>
        <CardHeader><CardTitle>Database</CardTitle></CardHeader>
        <CardContent>
          <div>
            <Label>Current Database Path (this PC)</Label>
            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-md border border-gray-200 font-mono break-all">
              {dbPath ?? 'No database open'}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            To change the database, use "Change Database" in the sidebar.
          </p>
        </CardContent>
      </Card>

      {/* Users + Activity */}
      <div className="grid grid-cols-2 gap-5">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2"><Users size={16} className="text-gray-400" /> Users</CardTitle>
              {!can.manageUsers && <AdminOnlyNote />}
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">Who may use EPL Tool, with which role (Admin, User, Viewer).</p>
            <Button variant="outline" onClick={() => navigate('/settings/users')} disabled={!can.manageUsers}>
              Manage Users →
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Activity size={16} className="text-gray-400" /> Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-600 mb-3">Every change: who, when, what. Visible to everybody.</p>
            <Button variant="outline" onClick={() => navigate('/settings/activity')}>Open Activity Log →</Button>
          </CardContent>
        </Card>
      </div>

      {/* Backups */}
      {dbOpen && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Backups</CardTitle>
              {!can.backup && <AdminOnlyNote />}
            </div>
          </CardHeader>
          <CardContent>
            <BackupPanel canCreate={can.backup} canRestore={can.backup} onRestored={() => window.location.reload()} />
          </CardContent>
        </Card>
      )}

      {/* Logo */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Company Logo</CardTitle>
            {!admin && <AdminOnlyNote />}
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="w-32 h-16 border border-gray-200 rounded-md bg-gray-50 flex items-center justify-center overflow-hidden">
              {logo.dataUrl ? (
                <img src={logo.dataUrl} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-gray-400 text-xs">No logo</span>
              )}
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">
                This logo appears in every exported price list. It is stored in the database, so exports made on any PC show it.
              </p>
              {admin && (
                <Button variant="outline" onClick={handleSelectLogo} disabled={!dbOpen}>
                  {logo.dataUrl ? 'Replace Logo' : 'Select Logo'}
                </Button>
              )}
              {logo.legacyPath && (
                <p className="text-xs text-amber-700 mt-2">
                  The logo was linked to a file on one PC ({logo.legacyPath}) and is no longer used in exports.
                  {admin ? ' Select it again to store it in the database.' : ' An admin needs to select it again.'}
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* PBP Emails */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>PBP Emails</CardTitle>
            {admin
              ? <Button size="sm" variant="outline" onClick={() => setEditingEmail({ id: null, name: '', value: '' })}><Plus size={13} className="mr-1" /> Add</Button>
              : <AdminOnlyNote />}
          </div>
        </CardHeader>
        <CardContent>
          {adminEmails.length === 0 ? (
            <p className="text-sm text-gray-400">No PBP emails configured.</p>
          ) : (
            <div className="space-y-3">
              {adminEmails.map(e => (
                <div key={e.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-0.5">{e.email_name}</div>
                    <div className="text-sm text-gray-900">{e.email}</div>
                  </div>
                  {admin && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditingEmail({ id: e.id, name: e.email_name, value: e.email })}>
                        Edit
                      </Button>
                      <Button variant="ghost" size="sm" className="text-red-500 hover:text-red-700 hover:bg-red-50" onClick={() => setRemoveEmail(e)}>
                        <Trash2 size={13} />
                      </Button>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            The entry whose name contains "Common" is the contact line of exported price lists; "Costing" and "Common" fill the
            PBP copy / PBP common addresses of new customers.
          </p>
        </CardContent>
      </Card>

      {/* Units */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Standard Units</CardTitle>
            {admin ? <Button size="sm" variant="outline" onClick={() => setAddingUnit(true)}>+ Add Unit</Button> : <AdminOnlyNote />}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {units.map(u => (
              <div key={u.id} className="flex items-center justify-between gap-3 py-1">
                <span className="text-sm font-mono text-gray-900">{u.name}</span>
                {admin && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50 h-6 px-2 text-xs"
                    onClick={() => handleDeleteUnit(u.id)}
                  >
                    Remove
                  </Button>
                )}
              </div>
            ))}
          </div>
          {addingUnit && (
            <div className="flex gap-2 mt-3">
              <Input
                autoFocus
                placeholder="e.g. 100 LB"
                value={newUnit}
                onChange={e => setNewUnit(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleAddUnit(); if (e.key === 'Escape') setAddingUnit(false); }}
                className="flex-1"
              />
              <Button size="sm" onClick={handleAddUnit}>Add</Button>
              <Button size="sm" variant="outline" onClick={() => { setAddingUnit(false); setNewUnit(''); }}>Cancel</Button>
            </div>
          )}
          <p className="text-xs text-gray-400 mt-3">
            These units appear in the Standard EPL price editor.
          </p>
        </CardContent>
      </Card>

      {/* Packaging */}
      <Card>
        <CardHeader><CardTitle>Packaging</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            Manage packaging versions (e.g. EUR-Standard, USD-Standard) and their line items. Each customer is assigned one version; its prices appear in their exported price list.
          </p>
          <Button variant="outline" onClick={() => navigate('/settings/packaging')}>
            {admin ? 'Manage Packaging →' : 'View Packaging →'}
          </Button>
        </CardContent>
      </Card>

      {/* Currencies */}
      <Card>
        <CardHeader><CardTitle>Currencies</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            USD and EUR are the main currencies with full Standard EPL support. Add other currencies (e.g. GBP) for individual customer price lists.
          </p>
          <Button variant="outline" onClick={() => navigate('/settings/currencies')}>
            {admin ? 'Manage Currencies →' : 'View Currencies →'}
          </Button>
        </CardContent>
      </Card>

      {/* Hidden Customers */}
      <Card>
        <CardHeader><CardTitle>Hidden Customers</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            Customers that have been hidden are excluded from all views and mass updates. Admins can restore them or permanently delete them along with their price lists.
          </p>
          <Button variant="outline" onClick={() => navigate('/settings/deleted-customers')}>
            {can.restoreCustomers ? 'Manage Hidden Customers →' : 'View Hidden Customers →'}
          </Button>
        </CardContent>
      </Card>

      {/* Add / edit PBP email dialog */}
      <Dialog
        open={!!editingEmail}
        onClose={() => setEditingEmail(null)}
        title={editingEmail?.id === null ? 'Add PBP Email' : 'Edit Email Address'}
      >
        {editingEmail && (
          <>
            {editingEmail.id === null && (
              <div className="mb-3">
                <Label>Name</Label>
                <Input
                  value={editingEmail.name}
                  onChange={e => setEditingEmail({ ...editingEmail, name: e.target.value })}
                  placeholder="e.g. PBP Common"
                />
              </div>
            )}
            <div className="mb-4">
              <Label>Email</Label>
              <Input
                value={editingEmail.value}
                onChange={e => setEditingEmail({ ...editingEmail, value: e.target.value })}
                type="email"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditingEmail(null)}>Cancel</Button>
              <Button onClick={handleSaveEmail}>Save</Button>
            </div>
          </>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!removeEmail}
        onClose={() => setRemoveEmail(null)}
        onConfirm={() => { if (removeEmail) handleRemoveEmail(removeEmail); }}
        title="Remove PBP Email"
        description={removeEmail ? `Remove ${removeEmail.email_name} (${removeEmail.email})? Existing customers keep the addresses they already have.` : ''}
        confirmLabel="Remove"
      />
    </div>
  );
}
