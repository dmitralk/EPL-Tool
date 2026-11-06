import { Lock } from 'lucide-react';
import { cn } from '../lib/utils';

// Shown where an action is not available to the current user, with the reason (e.g. "Managed by PBP — view only").
export function LockBadge({ reason, className, compact }: { reason: string; className?: string; compact?: boolean }) {
  return (
    <span
      title={reason}
      className={cn('inline-flex items-center gap-1 rounded-full bg-gray-100 text-gray-500 text-[11px] font-medium',
        compact ? 'px-1.5 py-0.5' : 'px-2 py-0.5', className)}
    >
      <Lock size={10} className="shrink-0" />
      {!compact && <span className="truncate">{reason}</span>}
    </span>
  );
}

// Card-level note for admin-only sections.
export function AdminOnlyNote({ className }: { className?: string }) {
  return <LockBadge reason="Admins only" className={className} />;
}
