import { useEffect, useState } from 'react';
import { Mail } from 'lucide-react';
import { api } from '../lib/ipc';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';
import { useToast } from './ui/toast';

const DEFAULT_SUBJECT = 'Price List — {customer} — {version}';
const DEFAULT_BODY = `Dear Customer,\n\nPlease find attached the updated price list for {customer_full}.\n\nEffective: {effective}\nVersion: {version}\n\nBest regards,`;

// Shared compose step for every "Email" button: edit the saved template, then export + open one draft per price list.
export function EmailComposeDialog({ open, onClose, priceListIds }: {
  open: boolean;
  onClose: () => void;
  priceListIds: string[];
}) {
  const { toast } = useToast();
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [sending, setSending] = useState(false);
  const n = priceListIds.length;

  useEffect(() => {
    if (!open) return;
    Promise.all([api.getPref('emailSubjectTemplate'), api.getPref('emailBodyTemplate')])
      .then(([s, b]) => {
        setSubject(s || DEFAULT_SUBJECT);
        setBody(b || DEFAULT_BODY);
      });
  }, [open]);

  async function handleSend() {
    setSending(true);
    try {
      // Saved on this PC only: sending an email never writes to the database.
      await Promise.all([
        api.setPref('emailSubjectTemplate', subject),
        api.setPref('emailBodyTemplate', body),
      ]);
      const result = await api.openMailBulk(priceListIds, subject, body) as {
        canceled?: boolean;
        results?: { id: string; error?: string }[];
      };
      if (result.canceled) return;
      const r = result.results ?? [];
      const ok = r.filter(x => !x.error).length;
      const fail = r.length - ok;
      if (fail === 0) {
        toast(`Opened ${ok} email${ok !== 1 ? 's' : ''} with attachments`, 'success');
      } else {
        const isPermission = r.some(x => x.error && (x.error.includes('-1743') || x.error.includes('Not authorized')));
        toast(isPermission
          ? 'Mail access denied. Go to System Settings → Privacy & Security → Automation → EPL Tool and enable Mail.'
          : `${ok} email${ok !== 1 ? 's' : ''} opened, ${fail} failed`, 'error');
      }
      onClose();
    } finally {
      setSending(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`Email ${n} Price List${n !== 1 ? 's' : ''}`}>
      <p className="text-xs text-gray-500 mb-3">
        Available placeholders: <code className="bg-gray-100 px-1 rounded">{'{customer}'}</code> <code className="bg-gray-100 px-1 rounded">{'{customer_full}'}</code> <code className="bg-gray-100 px-1 rounded">{'{version}'}</code> <code className="bg-gray-100 px-1 rounded">{'{effective}'}</code>
      </p>
      <div className="space-y-3 mb-4">
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Subject</label>
          <input
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
            value={subject}
            onChange={e => setSubject(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs font-medium text-gray-600 mb-1 block">Body</label>
          <textarea
            className="w-full text-sm border border-gray-300 rounded px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y font-mono"
            rows={8}
            value={body}
            onChange={e => setBody(e.target.value)}
          />
        </div>
      </div>
      <p className="text-xs text-gray-400 mb-4">
        Your template is saved on this PC when you send. You'll be asked for a folder to save the Excel file{n !== 1 ? 's' : ''}, which {n !== 1 ? 'are' : 'is'} attached to the draft{n !== 1 ? 's' : ''}.
      </p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose} disabled={sending}>Cancel</Button>
        <Button onClick={handleSend} disabled={sending || n === 0} className="gap-1.5">
          <Mail size={13} /> {sending ? 'Working…' : `Send ${n} Email${n !== 1 ? 's' : ''}`}
        </Button>
      </div>
    </Dialog>
  );
}
