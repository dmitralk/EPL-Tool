import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/ipc';
import { Card, CardContent } from '../../components/ui/card';
import { Button } from '../../components/ui/button';
import { useToast } from '../../components/ui/toast';
import type { ImportPreview, ImportOptions, MigrationResult } from '../../../types';

type Phase = 'idle' | 'analyzing' | 'ready' | 'importing' | 'done';
type EntityKey = keyof ImportOptions;

interface EntityConfig {
  key: EntityKey;
  title: string;
  description: string;
}

const ENTITIES: EntityConfig[] = [
  { key: 'adminEmails',  title: 'Admin Emails',         description: 'Shared email addresses used in export contact rows' },
  { key: 'customers',   title: 'Customers',             description: 'Customer masterdata — names, currencies, contact details' },
  { key: 'products',    title: 'Products',              description: 'Product catalogue with RIP codes and types' },
  { key: 'standardEpl', title: 'Standard EPL Prices',   description: 'Reference USD and EUR prices per product' },
  { key: 'packaging',   title: 'Packaging',             description: 'Packaging charges and pallets by version' },
  { key: 'priceLists',  title: 'Price List History',    description: 'Historical price lists and all their line entries' },
];

const DEFAULT_OPTIONS: ImportOptions = {
  adminEmails: true, customers: true, products: true,
  standardEpl: true, packaging: true, priceLists: true,
};

function resultTextFor(key: EntityKey, counts: MigrationResult['counts']): string {
  switch (key) {
    case 'adminEmails':  return `${counts.adminEmails} imported`;
    case 'customers':    return `${counts.customers} imported`;
    case 'products':     return `${counts.products} imported`;
    case 'standardEpl':  return `${counts.standardEpl} rows imported`;
    case 'packaging':    return `${counts.packaging} rows imported`;
    case 'priceLists':   return `${counts.priceLists} lists · ${counts.priceListEntries.toLocaleString()} entries`;
  }
}

export function ImportScreen() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [phase, setPhase] = useState<Phase>('idle');
  const [filePath, setFilePath] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selected, setSelected] = useState<ImportOptions>({ ...DEFAULT_OPTIONS });
  const [result, setResult] = useState<MigrationResult | null>(null);

  async function handleSelectFile() {
    const path = await api.migrationSelectFile();
    if (!path) return;
    setFilePath(path);
    setPreview(null);
    setResult(null);
    setSelected({ ...DEFAULT_OPTIONS });
    setPhase('analyzing');
    const p = await (api as any).migrationPreview(path) as ImportPreview;
    if (!p.success) {
      toast(`Could not read file: ${p.error}`, 'error');
      setPhase('idle');
      return;
    }
    setPreview(p);
    setPhase('ready');
  }

  function toggleEntity(key: EntityKey) {
    setSelected(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const selectedCount = (Object.values(selected) as boolean[]).filter(Boolean).length;

  async function handleImport() {
    if (!filePath) return;
    setPhase('importing');
    const res = await api.migrationImport(filePath, selected) as MigrationResult;
    setResult(res);
    setPhase('done');
    if (res.success) {
      toast('Import complete', 'success');
    } else {
      toast(`Import failed: ${res.error}`, 'error');
    }
  }

  function handleReset() {
    setPhase('idle');
    setFilePath(null);
    setPreview(null);
    setResult(null);
    setSelected({ ...DEFAULT_OPTIONS });
  }

  const fileName = filePath ? filePath.split(/[\\/]/).pop() : null;

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <button
          onClick={() => navigate('/settings')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-block"
        >
          ← Settings
        </button>
        <h1 className="text-2xl font-bold text-gray-900">Import from Excel</h1>
        <p className="text-sm text-gray-500 mt-1">
          Select your <strong className="text-gray-700">All_Prices.xlsx</strong> file to preview its contents, choose what to import, then click Import.
        </p>
      </div>

      {/* File selection */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              variant="outline"
              onClick={handleSelectFile}
              disabled={phase === 'analyzing' || phase === 'importing'}
            >
              {phase === 'analyzing' ? 'Analyzing…' : filePath ? 'Change File…' : 'Select File…'}
            </Button>
            {fileName && (
              <span className="text-sm font-medium text-gray-700">{fileName}</span>
            )}
          </div>
          {filePath && (
            <p className="text-xs text-gray-400 mt-1.5 font-mono break-all">{filePath}</p>
          )}
        </CardContent>
      </Card>

      {/* Entity cards — shown after analysis */}
      {preview && (
        <>
          <div className="space-y-2">
            {ENTITIES.map(({ key, title, description }) => {
              const sheet = preview[key];
              const isSelected = selected[key];
              const isDisabled = !sheet.available || phase === 'importing' || phase === 'done';
              const wasSelected = phase === 'done' && isSelected;
              const wasSkipped = phase === 'done' && !isSelected;

              return (
                <label
                  key={key}
                  className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors select-none ${
                    isDisabled && !sheet.available
                      ? 'border-gray-200 bg-gray-50 opacity-50 cursor-default'
                      : isSelected
                      ? 'border-blue-200 bg-blue-50/30 hover:bg-blue-50/50'
                      : 'border-gray-200 bg-white hover:bg-gray-50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => !isDisabled && toggleEntity(key)}
                    disabled={isDisabled}
                    className="mt-0.5 rounded border-gray-300 cursor-pointer shrink-0"
                    onClick={e => e.stopPropagation()}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="font-medium text-gray-900 text-sm">{title}</span>

                      {/* Status badge */}
                      {!sheet.available ? (
                        <span className="text-xs text-gray-400 italic">Sheet not found in file</span>
                      ) : phase === 'done' && wasSelected && result?.success ? (
                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                          ✓ {resultTextFor(key, result.counts)}
                        </span>
                      ) : phase === 'done' && wasSelected && !result?.success ? (
                        <span className="text-xs font-medium text-red-700 bg-red-100 px-2 py-0.5 rounded-full">
                          Failed
                        </span>
                      ) : wasSkipped ? (
                        <span className="text-xs text-gray-400 italic">Skipped</span>
                      ) : (
                        <span className="text-xs font-medium text-blue-700 bg-blue-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {sheet.count.toLocaleString()} {sheet.count === 1 ? 'record' : 'records'}
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-gray-500 mt-0.5">{description}</p>

                    {sheet.available && (
                      <div className="mt-1.5 space-y-0.5">
                        {/* Sample names */}
                        {sheet.samples.length > 0 && (
                          <p className="text-xs text-gray-500">
                            {sheet.samples.join(', ')}
                            {sheet.count > sheet.samples.length && (
                              <span className="text-gray-400"> +{(sheet.count - sheet.samples.length).toLocaleString()} more</span>
                            )}
                          </p>
                        )}
                        {/* Notes */}
                        {sheet.notes.map((note, i) => {
                          const isWarning = /replaced|skipped/i.test(note);
                          return (
                            <p key={i} className={`text-xs ${isWarning ? 'text-amber-600' : 'text-gray-500'}`}>
                              {isWarning ? '⚠ ' : ''}{note}
                            </p>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </label>
              );
            })}
          </div>

          {/* Action bar */}
          <div className="flex items-center justify-between pt-1 gap-4">
            {phase === 'done' ? (
              <>
                {result?.success ? (
                  <p className="text-sm font-medium text-green-700">Import completed successfully.</p>
                ) : (
                  <p className="text-sm font-medium text-red-700">Import failed: {result?.error}</p>
                )}
                <Button variant="outline" onClick={handleReset}>Import Another File</Button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-500">
                  {selectedCount} of {ENTITIES.length} entities selected
                </span>
                <Button
                  onClick={handleImport}
                  disabled={selectedCount === 0 || phase === 'importing'}
                >
                  {phase === 'importing' ? 'Importing…' : `Import Selected (${selectedCount})`}
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
