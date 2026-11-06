import { useEffect, useState } from 'react';
import { api } from '../../lib/ipc';
import { SearchableSelect } from '../../components/ui/searchable-select';
import { ROLE_LABELS } from '../../../shared/permissions';
import type { AppUser } from '../../../types';

// Active Admins and Users can manage customers; people already listed stay selectable.
export function ManagersPicker({ values, onChange, keep = [] }: {
  values: number[];
  onChange: (ids: number[]) => void;
  keep?: number[];
}) {
  const [users, setUsers] = useState<AppUser[]>([]);
  useEffect(() => { api.listUsers().then(u => setUsers(u as AppUser[])); }, []);
  const options = users
    .filter(u => (u.is_active && u.role !== 'viewer') || keep.includes(u.id))
    .map(u => ({ value: String(u.id), label: u.display_name, sublabel: ROLE_LABELS[u.role], keywords: u.email ?? '' }));
  return (
    <SearchableSelect
      multiple
      values={values.map(String)}
      onChange={v => onChange(v.map(Number))}
      options={options}
      placeholder="Choose managers…"
      pluralLabel="managers"
      searchPlaceholder="Search people…"
      className="w-full"
    />
  );
}
