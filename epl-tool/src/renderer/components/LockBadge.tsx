import { Lock } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCan } from '../lib/auth';

// Shown where an action is not available to the current user, with the reason (e.g. "Managed by PBP — view only").
// label: shorter text to show (the full reason stays in the tooltip).
export function LockBadge({ reason, label, className, compact }: { reason: string; label?: string; className?: string; compact?: boolean }) {
  return (
    <span
      title={reason}
      className={cn('inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5', className)}
    >
      <Lock size={10} className="shrink-0" />
      {!compact && <span className="truncate">{label ?? reason}</span>}
    </span>
  );
}

// Card-level note for admin-only sections (for admins on a read-only copy: why it is locked right now).
export function AdminOnlyNote({ className }: { className?: string }) {
  const can = useCan();
  if (can.isAdmin && can.readOnly) return <LockBadge reason={can.readOnly} label="Read-only" className={className} />;
  return <LockBadge reason="Admins only" className={className} />;
}
