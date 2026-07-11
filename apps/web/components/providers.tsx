"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { CheckCircle2, X, AlertTriangle, Info } from "lucide-react";

type Toast = {
  id: number;
  title: string;
  description?: string;
  tone?: "success" | "error" | "info";
};
type ToastInput = Omit<Toast, "id">;
const ToastContext = createContext<(toast: ToastInput) => void>(
  () => undefined,
);

export function useToast() {
  return useContext(ToastContext);
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const saved = localStorage.getItem("mcpops-theme");
    const dark = saved
      ? saved === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  }, []);
  const show = useCallback((input: ToastInput) => {
    const id = Date.now();
    setToasts((current) => [...current, { ...input, id }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      5200,
    );
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed bottom-5 right-5 z-[100] flex w-[min(380px,calc(100vw-40px))] flex-col gap-2"
        aria-live="polite"
      >
        {toasts.map((toast) => {
          const Icon =
            toast.tone === "error"
              ? AlertTriangle
              : toast.tone === "success"
                ? CheckCircle2
                : Info;
          return (
            <div
              key={toast.id}
              className="animate-fade-in rounded-xl border bg-card p-4 shadow-panel"
            >
              <div className="flex gap-3">
                <Icon
                  className={
                    toast.tone === "error"
                      ? "text-red-500"
                      : toast.tone === "success"
                        ? "text-emerald-500"
                        : "text-primary"
                  }
                  size={18}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{toast.title}</p>
                  {toast.description && (
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {toast.description}
                    </p>
                  )}
                </div>
                <button
                  aria-label="Dismiss"
                  onClick={() =>
                    setToasts((current) =>
                      current.filter((item) => item.id !== toast.id),
                    )
                  }
                >
                  <X size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}
