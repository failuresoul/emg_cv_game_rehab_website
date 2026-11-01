import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { t } from "@/i18n";

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** Native <dialog>: traps focus, closes on Escape and restores focus when closed. */
export function Modal({ open, title, onClose, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog element itself, not its content, is on the backdrop.
        if (event.target === dialogRef.current) onClose();
      }}
      className="bg-surface text-ink m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl p-0 backdrop:bg-black/50"
    >
      <div className="p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id={titleId} className="text-xl font-bold">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.close")}
            className="hover:bg-primary-light inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-lg"
          >
            <X size={24} aria-hidden />
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
