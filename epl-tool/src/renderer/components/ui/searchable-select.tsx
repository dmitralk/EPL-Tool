import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SearchableOption {
  value: string;
  label: string;
  sublabel?: string;
  keywords?: string;  // extra text matched by the search but not displayed
}

interface SearchableSelectProps {
  values: string[];
  onChange: (values: string[]) => void;
  options: SearchableOption[];
  placeholder: string;           // shown when nothing is selected
  multiple?: boolean;            // checkboxes + select all; empty selection means "all"
  pluralLabel?: string;          // multiple mode: "3 customers selected"
  searchPlaceholder?: string;
  className?: string;
}

// Dropdown with a search box inside (Power BI slicer style).
export function SearchableSelect({
  values, onChange, options, placeholder, multiple = false, pluralLabel = 'items', searchPlaceholder = 'Search…', className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = new Set(values);
  const q = query.trim().toLowerCase();
  const filtered = options.filter(o => !q || [o.label, o.sublabel, o.keywords].some(t => (t ?? '').toLowerCase().includes(q)));
  const allFilteredSelected = filtered.length > 0 && filtered.every(o => selected.has(o.value));

  useEffect(() => { setHighlight(0); }, [query, open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  function close() {
    setOpen(false);
    setQuery('');
  }

  function pick(v: string) {
    if (!multiple) {
      onChange([v]);
      close();
      return;
    }
    onChange(selected.has(v) ? values.filter(x => x !== v) : [...values, v]);
  }

  function toggleAllFiltered() {
    const ids = new Set(filtered.map(o => o.value));
    onChange(allFilteredSelected
      ? values.filter(v => !ids.has(v))
      : [...values, ...filtered.map(o => o.value).filter(v => !selected.has(v))]);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => Math.min(h + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => Math.max(h - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlight]) pick(filtered[highlight].value); }
    else if (e.key === 'Escape') close();
  }

  const single = values.length === 1 ? options.find(o => o.value === values[0]) : undefined;

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-9 w-full items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-blue-500"
      >
        <span className={cn('flex-1 truncate', values.length ? 'text-gray-900' : 'text-gray-500')}>
          {values.length === 0 ? placeholder : single ? single.label : `${values.length} ${pluralLabel} selected`}
          {single?.sublabel && <span className="ml-2 font-mono text-xs text-gray-400">{single.sublabel}</span>}
        </span>
        {multiple && values.length > 0 && (
          <span
            role="button"
            title="Clear selection"
            onClick={e => { e.stopPropagation(); onChange([]); }}
            className="text-gray-400 hover:text-gray-600"
          >
            <X size={14} />
          </span>
        )}
        <ChevronDown size={14} className="text-gray-400 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={close} />
          <div className="absolute left-0 z-20 mt-1 w-full min-w-[20rem] bg-white border border-gray-200 rounded-lg shadow-lg">
            <div className="relative p-2 border-b border-gray-100">
              <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full h-9 rounded-md border border-gray-300 pl-8 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {multiple && filtered.length > 0 && (
              <label className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 border-b border-gray-100 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={allFilteredSelected} onChange={toggleAllFiltered} />
                {q ? `Select all matching (${filtered.length})` : 'Select all'}
              </label>
            )}

            <div ref={listRef} className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-gray-400">No matches</p>
              ) : filtered.map((o, i) => {
                const isSel = selected.has(o.value);
                const rowClass = cn(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left cursor-pointer',
                  i === highlight ? 'bg-blue-50' : '',
                  isSel ? (multiple ? 'text-blue-700' : 'font-semibold text-blue-700') : 'text-gray-800',
                );
                const content = (
                  <>
                    <span className="flex-1 truncate">{o.label}</span>
                    {o.sublabel && <span className="font-mono text-xs text-gray-400 shrink-0">{o.sublabel}</span>}
                  </>
                );
                return multiple ? (
                  <label key={o.value} data-index={i} onMouseEnter={() => setHighlight(i)} className={rowClass}>
                    <input type="checkbox" checked={isSel} onChange={() => pick(o.value)} />
                    {content}
                  </label>
                ) : (
                  <button type="button" key={o.value} data-index={i} onMouseEnter={() => setHighlight(i)} onClick={() => pick(o.value)} className={rowClass}>
                    {content}
                  </button>
                );
              })}
            </div>

            {multiple && (
              <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
                <span className="text-xs text-gray-500">{values.length ? `${values.length} selected` : `All ${pluralLabel}`}</span>
                <div className="flex items-center gap-3">
                  <button type="button" className="text-xs text-gray-500 hover:text-gray-700" onClick={() => onChange([])}>Clear</button>
                  <button type="button" className="text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded px-3 py-1" onClick={close}>Done</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
