import { useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, ShieldCheck } from 'lucide-react';
import { api } from '../../lib/ipc';
import { useAuth, useCan } from '../../lib/auth';
import { ipcErrorMessage } from '../../lib/utils';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { useToast } from '../../components/ui/toast';
import { ModeBadge } from '../../components/ModeBadge';
import { LockBadge } from '../../components/LockBadge';
import { ManagersPicker } from './ManagersPicker';
import { PRICING_MODE_LABELS, PRICING_MODES, accessChangeError, canChangeCustomerAccess } from '../../../shared/permissions';
import type { Customer, PricingMode } from '../../../types';

const MODE_HELP: Record<PricingMode, string> = {
  open: 'Every admin and user can change price lists, emails and master data.',
  pbp: 'Only admins can change price lists, emails and master data.',
  managed: 'The named managers and admins can change price lists, emails and master data.',
};

// Mode + managers (access-rights study §3.3): editable by admins, and by managers for their own customers.
export function PricingManagementCard({ customer, onChanged }: { customer: Customer; onChanged: (c: Customer) => void }) {
  const can = useCan();
  const { refresh } = useAuth();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [mode, setMode] = useState<PricingMode>(customer.pricing_mode);
  const [managers, setManagers] = useState<number[]>(customer.manager_ids);
  const [saving, setSaving] = useState(false);

  const editable = can.changeAccess(customer);
  const next = { pricing_mode: mode, manager_ids: mode === 'managed' ? managers : [] };
  const problem = editing ? accessChangeError(can.user, customer, next) : null;
  const losesRights = !can.isAdmin && editing &&
    (mode === 'pbp' || (mode === 'managed' && can.user !== null && !managers.includes(can.user.id)));

  function start() {
    setMode(customer.pricing_mode);
    setManagers(customer.manager_ids);
    setEditing(true);
  }

  async function save() {
    setSaving(true);
    try {
      const updated = await api.setCustomerAccess(customer.customer_ref_sap, next) as Customer;
      onChanged(updated);
      await refresh();
      setEditing(false);
      toast('Pricing management updated', 'success');
    } catch (err) {
      toast(ipcErrorMessage(err), 'error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="mb-6">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-gray-400" /> Pricing management
            <Link to="/help/pricing-modes" title="About pricing management modes" className="text-gray-400 hover:text-blue-600">
              <HelpCircle size={14} />
            </Link>
          </CardTitle>
          {!editing && (editable
            ? <Button variant="outline" size="sm" onClick={start}>Change</Button>
            : <LockBadge reason={can.why(canChangeCustomerAccess(can.user, customer), "Admins and this customer's managers can change this")} />)}
        </div>
      </CardHeader>
      <CardContent>
        {!editing ? (
          <div className="flex items-center gap-3 text-sm">
            <ModeBadge customer={customer} />
            <span className="text-gray-500">{MODE_HELP[customer.pricing_mode]}</span>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-4">
              {PRICING_MODES.map(m => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="pricing-mode" checked={mode === m} onChange={() => setMode(m)} />
                  {PRICING_MODE_LABELS[m]}
                </label>
              ))}
            </div>
            <p className="text-gray-500">{MODE_HELP[mode]}</p>
            {mode === 'managed' && <ManagersPicker values={managers} onChange={setManagers} keep={customer.manager_ids} />}
            {losesRights && !problem && (
              <p className="text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                After this change you will no longer be able to change this customer.
              </p>
            )}
            {problem && <p className="text-red-600">{problem}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>Cancel</Button>
              <Button onClick={save} disabled={saving || !!problem}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
