import clsx from "clsx";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";

import { t } from "@/i18n";
import { onApiError } from "@/lib/apiErrors";

const AUTO_HIDE_MS = 4000;

type ToastVariant = "success" | "error";

interface ToastItem {
  id: number;
  variant: ToastVariant;
  message: string;
}

type ShowToast = (variant: ToastVariant, message: string) => void;

const ToastContext = createContext<ShowToast | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback<ShowToast>(
    (variant, message) => {
      const id = nextId.current++;
      setToasts((current) => [...current, { id, variant, message }]);
      setTimeout(() => dismiss(id), AUTO_HIDE_MS);
    },
    [dismiss],
  );

  // Failed requests anywhere in the app, reported by the query client.
  useEffect(() => onApiError((key) => show("error", t(key))), [show]);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className="fixed right-4 bottom-4 left-4 z-50 flex flex-col items-end gap-2"
      >
        {toasts.map(({ id, variant, message }) => {
          const Icon = variant === "success" ? CircleCheck : CircleAlert;
          return (
            <div
              key={id}
              role={variant === "error" ? "alert" : "status"}
              className={clsx(
                "flex max-w-md items-center gap-2 rounded-lg py-1 pr-1 pl-4 text-white shadow-lg",
                variant === "success" ? "bg-success" : "bg-danger",
              )}
            >
              <Icon size={22} aria-hidden className="shrink-0" />
              <p>{message}</p>
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => dismiss(id)}
                className="inline-flex min-h-11 min-w-11 shrink-0 cursor-pointer items-center justify-center"
              >
                <X size={20} aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ShowToast {
  const show = useContext(ToastContext);
  if (!show) {
    throw new Error("useToast must be used inside ToastProvider");
  }
  return show;
}
