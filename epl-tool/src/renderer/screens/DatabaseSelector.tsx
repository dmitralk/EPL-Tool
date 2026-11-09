import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Cloud, FolderOpen, Plus, Database, ShieldAlert, Loader2 } from 'lucide-react';
import { api } from '../lib/ipc';
import { useAuth } from '../lib/auth';
import { useSync } from '../lib/syncState';
import { statusLine } from '../lib/sync';
import { Button } from '../components/ui/button';
import { BackupPanel } from '../components/BackupPanel';
import type { DbOpenError, SyncStatus } from '../../types';

// Setup screen (/setup, also "Change Database"): connect to the shared database — EPL Tool then works on a copy that is
// kept up to date (dev-plan Phase C) — or open / create a local database (no sharing; test databases, development).
export function DatabaseSelector() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const { status, setStatus } = useSync();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<DbOpenError | null>(null);

  async function refreshOpenError() {
    setOpenError(await api.dbLastOpenError() as DbOpenError | null);
  }

  useEffect(() => { refreshOpenError(); }, []);

  async function done() {
    setStatus(await api.getSyncStatus() as SyncStatus);
    const next = await refresh();
    navigate(next.user ? '/' : '/no-access');
  }

  async function handleConnect(centralPath?: string) {
    setError(null);
    const target = centralPath ?? await api.selectSharedDb() as string | null;
    if (!target) return;
    setLoading('connect');
    const result = await api.connectShared(target) as { ok: boolean; error?: string };
    setLoading(null);
    if (result.ok) await done();
    else {
      setError(result.error ?? 'Could not connect to the shared database');
      setStatus(await api.getSyncStatus() as SyncStatus);
    }
  }

  async function handleOpen(filePath?: string) {
    setError(null);
    const target = filePath ?? await api.dbSelectFile() as string | null;
    if (!target) return;
    setLoading('open');
    const result = await api.dbOpen(target);
    setLoading(null);
    if (result.ok) await done();
    else {
      setError(result.error ?? 'Failed to open database');
      await refreshOpenError();
    }
  }

  async function handleCreate() {
    setError(null);
    setLoading('create');
    const result = await api.dbCreate();
    setLoading(null);
    if (result.ok) await done();
    else if (result.error !== 'Cancelled') setError(result.error ?? 'Failed to create database');
  }

  const editing = status?.phase === 'edit';
  const connected = !!status && status.mode !== 'none' && status.phase !== 'connecting';
  const suggestion = status?.legacySuggestion ?? null;
  const startupError = status?.mode === 'none' ? status.error : null;
  const disabled = !!loading || editing;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center p-6">
      <div className={`bg-white rounded-2xl shadow-xl w-full p-8 ${openError?.corrupt ? 'max-w-2xl' : 'max-w-lg'}`}>
        {/* Logo area */}
        <div className="flex items-center justify-center mb-6">
          <div className="bg-blue-600 rounded-xl p-3">
            <Database size={32} className="text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">EPL Tool</h1>
        <p className="text-gray-500 text-center text-sm mb-6">Export Price List Manager</p>

        {connected && status && (
          <div className="mb-5 flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
            <div className="flex-1 min-w-0">
              <p className="font-medium text-gray-800">Now: {statusLine(status).text}</p>
              <p className="font-mono text-xs text-gray-500 break-all mt-0.5">{status.path}</p>
              {editing && <p className="text-amber-700 mt-1">Finish editing first to change the database.</p>}
            </div>
            <Button variant="outline" size="sm" className="gap-1 shrink-0" onClick={() => navigate('/')}>
              <ArrowLeft size={13} /> Back
            </Button>
          </div>
        )}

        {status?.phase === 'connecting' && (
          <div className="mb-5 flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
            <Loader2 size={15} className="animate-spin" /> Connecting to the shared database…
          </div>
        )}

        {suggestion && (
          <div className="mb-5 p-4 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-900">
            <p className="font-medium">You used this database before. It is in a shared OneDrive / SharePoint folder:</p>
            <p className="font-mono text-xs break-all my-1.5">{suggestion.path}</p>
            <p className="mb-3">Connect to it as the shared database, so everybody always works on the latest data.</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => handleConnect(suggestion.path)} disabled={disabled} className="gap-1.5">
                <Cloud size={14} /> Connect as shared database
              </Button>
              <Button size="sm" variant="outline" onClick={() => handleOpen(suggestion.path)} disabled={disabled}>
                Open as local database
              </Button>
            </div>
          </div>
        )}

        {openError?.corrupt && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <div className="flex items-start gap-2 mb-3">
              <ShieldAlert size={18} className="text-red-600 shrink-0 mt-0.5" />
              <div className="text-sm text-red-800">
                <p className="font-semibold">The database appears to be damaged and was not opened.</p>
                <p className="font-mono text-xs break-all mt-1">{openError.path}</p>
                <p className="text-xs mt-1">{openError.message}</p>
                <p className="mt-2">Restore the most recent backup below. The damaged file is kept as a “pre-restore” copy.</p>
              </div>
            </div>
            <div className="bg-white rounded-md p-3">
              <BackupPanel canCreate={false} onRestored={() => navigate('/')} />
            </div>
          </div>
        )}

        <div className="space-y-3">
          <Button onClick={() => handleConnect()} disabled={disabled} className="w-full h-12 text-base gap-3">
            {loading === 'connect' ? <Loader2 size={18} className="animate-spin" /> : <Cloud size={18} />}
            Connect to shared database
          </Button>
          <p className="text-xs text-gray-500 -mt-1 px-1">
            Choose the database file in the SharePoint folder synced to this PC. EPL Tool works on a copy that it keeps up to
            date; admins click <b>Start editing</b> to make changes.
          </p>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" onClick={() => handleOpen()} disabled={disabled} className="flex-1 gap-2">
              <FolderOpen size={15} /> Open a local database
            </Button>
            <Button variant="outline" onClick={handleCreate} disabled={disabled} className="flex-1 gap-2">
              <Plus size={15} /> New local database
            </Button>
          </div>
          <p className="text-xs text-gray-400 px-1">Local databases are opened directly and not shared (tests, development).</p>
        </div>

        {(error || startupError || (openError && !openError.corrupt)) && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 break-all">
            {error ?? startupError ?? (openError ? `Could not open ${openError.path}: ${openError.message}` : '')}
          </div>
        )}

        {connected && (
          <p className="mt-6 text-xs text-gray-400 text-center">
            <Link to="/help/shared-database" className="hover:underline">How the shared database works</Link>
          </p>
        )}
      </div>
    </div>
  );
}
