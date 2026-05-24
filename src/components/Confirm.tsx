// Small modal confirm dialog. Uses native <dialog>.

import { useEffect, useRef } from 'react';

interface Props {
  open: boolean;
  title: string;
  body?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function Confirm({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onCancel}
      className="rounded-lg p-0 bg-parchment-light text-walnut border border-brass/40 shadow-xl backdrop:bg-walnut-dark/60"
    >
      <div className="p-6 max-w-md">
        <h3 className="text-xl font-display mb-2">{title}</h3>
        {body && <div className="text-sm mb-4">{body}</div>}
        <div className="flex justify-end gap-2">
          <button className="btn-secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            className={danger ? 'btn-danger' : 'btn-primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}
