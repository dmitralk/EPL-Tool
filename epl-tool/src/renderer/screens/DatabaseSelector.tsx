import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Database, ShieldAlert } from 'lucide-react';
import { api } from '../lib/ipc';
import { Button } from '../components/ui/button';
import { BackupPanel } from '../components/BackupPanel';
import type { DbOpenError } from '../../types';

export function DatabaseSelector() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<DbOpenError | null>(null);

  async function refreshOpenError() {
    setOpenError(await api.dbLastOpenError() as DbOpenError | null);
  }

  useEffect(() => { refreshOpenError(); }, []);

  async function handleOpen() {
    setError(null);
    const filePath = await api.dbSelectFile();
    if (!filePath) return;
    setLoading(true);
    const result = await api.dbOpen(filePath);
    setLoading(false);
    if (result.ok) navigate('/');
    else {
      setError(result.error ?? 'Failed to open database');
      await refreshOpenError();
    }
  }

  async function handleCreate() {
    setError(null);
    setLoading(true);
    const result = await api.dbCreate();
    setLoading(false);
    if (result.ok) navigate('/');
    else if (result.error !== 'Cancelled') setError(result.error ?? 'Failed to create database');
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-gray-100 flex items-center justify-center p-6">
      <div className={`bg-white rounded-2xl shadow-xl w-full p-8 ${openError?.corrupt ? 'max-w-2xl' : 'max-w-md'}`}>
        {/* Logo area */}
        <div className="flex items-center justify-center mb-6">
          <div className="bg-blue-600 rounded-xl p-3">
            <Database size={32} className="text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">EPL Tool</h1>
        <p className="text-gray-500 text-center text-sm mb-8">Export Price List Manager</p>

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
          <Button
            onClick={handleOpen}
            disabled={loading}
            className="w-full h-12 text-base gap-3"
          >
            <FolderOpen size={18} />
            Open existing database
          </Button>

          <Button
            variant="outline"
            onClick={handleCreate}
            disabled={loading}
            className="w-full h-12 text-base gap-3"
          >
            <Plus size={18} />
            Create new database
          </Button>
        </div>

        {(error || openError) && !openError?.corrupt && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700 break-all">
            {openError && !openError.corrupt ? `Could not open ${openError.path}: ${openError.message}` : error}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400 text-center">
          The database can be stored on a shared drive or SharePoint folder.
        </p>
      </div>
    </div>
  );
}
