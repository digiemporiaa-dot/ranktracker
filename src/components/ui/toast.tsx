'use client';

import * as React from 'react';
import { CheckCircle2, AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

type Toast = { id: number; message: string; tone: 'success' | 'error' };

const ToastContext = React.createContext<(message: string, tone?: Toast['tone']) => void>(
  () => undefined,
);

/** Read-only hook: call `toast('Saved')` from anywhere under the provider. */
export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const nextId = React.useRef(0);

  const push = React.useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = (nextId.current += 1);
    setToasts((current) => [...current, { id, message, tone }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed bottom-4 left-1/2 z-[60] flex w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 flex-col gap-2"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'pointer-events-auto flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm shadow-lg',
              toast.tone === 'error'
                ? 'border-destructive/30 bg-card text-destructive'
                : 'border-success/30 bg-card text-success',
            )}
          >
            {toast.tone === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            )}
            <span className="text-foreground">{toast.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
