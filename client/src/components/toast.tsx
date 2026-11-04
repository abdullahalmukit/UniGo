// Small toast messages (CLAUDE.md UI rule): one at a time, bottom of the
// screen, gone after a few seconds.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import styles from "./toast.module.css";

type Tone = "success" | "error";
type Toast = { id: number; message: string; tone: Tone };
type ToastContextValue = { show: (message: string, tone?: Tone) => void };

const ToastContext = createContext<ToastContextValue | null>(null);
const DURATION_MS = 3500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const counter = useRef(0);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), DURATION_MS);
    return () => clearTimeout(timer);
  }, [toast]);

  const show = useCallback((message: string, tone: Tone = "success") => {
    counter.current += 1;
    setToast({ id: counter.current, message, tone });
  }, []);
  const value = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className={styles.region} role="status" aria-live="polite">
        {toast && (
          <div key={toast.id} className={`${styles.toast} ${styles[toast.tone]}`}>
            {toast.message}
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

// Outside a provider (some tests) toasts are simply not shown.
const noToasts: ToastContextValue = { show: () => {} };

export function useToast() {
  return useContext(ToastContext) ?? noToasts;
}
