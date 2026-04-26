import { useEffect, useState } from 'react';
import { api } from '../../lib/ipc';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { Input, Label } from '../../components/ui/input';
import { useToast } from '../../components/ui/toast';
import { Dialog } from '../../components/ui/dialog';
import type { AdminEmail } from '../../../types';

export function SettingsScreen() {
  const { toast } = useToast();
  const [dbPath, setDbPath] = useState<string | null>(null);
  const [logoPath, setLogoPath] = useState<string | null>(null);
  const [adminEmails, setAdminEmails] = useState<AdminEmail[]>([]);
  const [editingEmail, setEditingEmail] = useState<{ id: number; value: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const [path, logo, emails] = await Promise.all([
        api.dbGetPath(),
        api.getSetting('logo_path'),
        api.getAdminEmails(),
      ]);
      setDbPath(path);
      setLogoPath(logo);
      setAdminEmails(emails as AdminEmail[]);
    }
    load();
  }, []);

  async function handleSelectLogo() {
    const path = await api.selectLogo();
    if (path) {
      setLogoPath(path);
      toast('Logo updated', 'success');
    }
  }

  async function handleSaveEmail() {
    if (!editingEmail) return;
    await api.updateAdminEmail(editingEmail.id, editingEmail.value);
    setAdminEmails(prev => prev.map(e => e.id === editingEmail.id ? { ...e, email: editingEmail.value } : e));
    setEditingEmail(null);
    toast('Email updated', 'success');
  }

  async function handleImport() {
    const filePath = await api.migrationSelectFile();
    if (!filePath) return;
    setImporting(true);
    setImportResult(null);
    const result = await api.migrationImport(filePath);
    setImporting(false);
    if (result.success) {
      const c = result.counts;
      setImportResult(`Import complete: ${c.customers} customers, ${c.products} products, ${c.standardEpl} EPL rows, ${c.packaging} packaging, ${c.priceLists} price lists.`);
      toast('Data imported', 'success');
    } else {
      setImportResult(`Import failed: ${result.error}`);
      toast('Import failed', 'error');
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      <h1 className="text-2xl font-bold text-gray-900">Settings</h1>

      {/* Database */}
      <Card>
        <CardHeader><CardTitle>Database</CardTitle></CardHeader>
        <CardContent>
          <div>
            <Label>Current Database Path</Label>
            <div className="text-sm text-gray-600 bg-gray-50 px-3 py-2 rounded-md border border-gray-200 font-mono break-all">
              {dbPath ?? 'No database open'}
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            To change the database, use "Change Database" in the sidebar.
          </p>
        </CardContent>
      </Card>

      {/* Logo */}
      <Card>
        <CardHeader><CardTitle>Company Logo</CardTitle></CardHeader>
        <CardContent>
          <div className="flex items-start gap-4">
            <div className="w-32 h-16 border border-gray-200 rounded-md bg-gray-50 flex items-center justify-center overflow-hidden">
              {logoPath ? (
                <img src={`file://${logoPath}`} alt="Logo" className="max-w-full max-h-full object-contain" />
              ) : (
                <span className="text-gray-400 text-xs">No logo</span>
              )}
            </div>
            <div>
              <p className="text-sm text-gray-600 mb-2">
                This logo appears in every exported price list.
              </p>
              <Button variant="outline" onClick={handleSelectLogo}>
                {logoPath ? 'Replace Logo' : 'Select Logo'}
              </Button>
              {logoPath && (
                <p className="text-xs text-gray-400 mt-1 font-mono break-all">{logoPath}</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Admin Emails */}
      <Card>
        <CardHeader><CardTitle>Admin Email Addresses</CardTitle></CardHeader>
        <CardContent>
          {adminEmails.length === 0 ? (
            <p className="text-sm text-gray-400">No admin emails configured. Import from Excel to populate.</p>
          ) : (
            <div className="space-y-3">
              {adminEmails.map(e => (
                <div key={e.id} className="flex items-center gap-3">
                  <div className="flex-1">
                    <div className="text-xs text-gray-500 mb-0.5">{e.email_name}</div>
                    <div className="text-sm text-gray-900">{e.email}</div>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setEditingEmail({ id: e.id, value: e.email })}>
                    Edit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Import */}
      <Card>
        <CardHeader><CardTitle>Import Data from Excel</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-gray-600 mb-3">
            Import customers, products, standard EPL prices, packaging, and price list history from your <strong>All_Prices.xlsx</strong> file.
          </p>
          <Button onClick={() => setImportOpen(true)} variant="outline">
            Import from Excel…
          </Button>
        </CardContent>
      </Card>

      {/* Edit email dialog */}
      <Dialog
        open={!!editingEmail}
        onClose={() => setEditingEmail(null)}
        title="Edit Email Address"
      >
        {editingEmail && (
          <>
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

      {/* Import dialog */}
      <Dialog open={importOpen} onClose={() => { setImportOpen(false); setImportResult(null); }} title="Import from Excel">
        <p className="text-sm text-gray-600 mb-4">
          Select your <strong>All_Prices.xlsx</strong> file. Existing records will be updated; new ones added.
        </p>
        {importResult && (
          <div className={`p-3 rounded-md text-sm mb-4 ${importResult.startsWith('Import failed') ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-800'}`}>
            {importResult}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => { setImportOpen(false); setImportResult(null); }}>Close</Button>
          <Button onClick={handleImport} disabled={importing}>
            {importing ? 'Importing…' : 'Select File & Import'}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
