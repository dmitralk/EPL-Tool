import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FolderOpen, Plus, Database } from 'lucide-react';
import { api } from '../lib/ipc';
import { Button } from '../components/ui/button';

export function DatabaseSelector() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleOpen() {
    setError(null);
    const filePath = await api.dbSelectFile();
    if (!filePath) return;
    setLoading(true);
    const result = await api.dbOpen(filePath);
    setLoading(false);
    if (result.ok) navigate('/');
    else setError(result.error ?? 'Failed to open database');
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
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        {/* Logo area */}
        <div className="flex items-center justify-center mb-6">
          <div className="bg-blue-600 rounded-xl p-3">
            <Database size={32} className="text-white" />
          </div>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">EPL Tool</h1>
        <p className="text-gray-500 text-center text-sm mb-8">Export Price List Manager</p>

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

        {error && (
          <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
            {error}
          </div>
        )}

        <p className="mt-6 text-xs text-gray-400 text-center">
          The database can be stored on a shared drive or SharePoint folder.
        </p>
      </div>
    </div>
  );
}
