import { useEffect, useRef } from 'react';
import { cn } from '../../lib/utils';
import { Button } from './button';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}

export function Dialog({ open, onClose, title, children, className }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const pressStartedOutside = useRef(false);
  // Once the user has clicked or typed inside, only explicit buttons (×, Cancel, actions) close the dialog.
  const dirty = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open) {
      dirty.current = false;
      el.showModal();
    } else {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onClose();
    const handleCancel = (e: Event) => { if (dirty.current) e.preventDefault(); };
    el.addEventListener('close', handleClose);
    el.addEventListener('cancel', handleCancel);
    return () => {
      el.removeEventListener('close', handleClose);
      el.removeEventListener('cancel', handleCancel);
    };
  }, [onClose]);

  if (!open) return null;

  // Backdrop clicks target the <dialog> itself, so also check the pointer is outside its box.
  function isOutside(e: React.MouseEvent<HTMLDialogElement>): boolean {
    if (e.target !== e.currentTarget) return false;
    const r = e.currentTarget.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  }

  return (
    <dialog
      ref={ref}
      className={cn(
        'rounded-lg border border-gray-200 shadow-xl p-0 backdrop:bg-black/40',
        'max-w-lg w-full open:flex open:flex-col',
        className,
      )}
      onMouseDown={(e) => {
        pressStartedOutside.current = isOutside(e);
        if (!pressStartedOutside.current) dirty.current = true;
      }}
      onClick={(e) => {
        // A drag that starts inside (scrollbar, text selection) and ends outside must not close.
        const shouldClose = pressStartedOutside.current && isOutside(e) && !dirty.current;
        pressStartedOutside.current = false;
        if (shouldClose) onClose();
      }}
      onInput={() => { dirty.current = true; }}
    >
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          aria-label="Close"
        >
          ×
        </button>
      </div>
      <div className="p-5 overflow-y-auto max-h-[70vh]">{children}</div>
    </dialog>
  );
}

export function DialogFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex justify-end gap-2 px-5 py-4 border-t border-gray-200', className)}>
      {children}
    </div>
  );
}

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  variant?: 'destructive' | 'default';
}

export function ConfirmDialog({ open, onClose, onConfirm, title, description, confirmLabel = 'Confirm', variant = 'destructive' }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <p className="text-sm text-gray-600 mb-4">{description}</p>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant={variant} onClick={() => { onConfirm(); onClose(); }}>{confirmLabel}</Button>
      </div>
    </Dialog>
  );
}
