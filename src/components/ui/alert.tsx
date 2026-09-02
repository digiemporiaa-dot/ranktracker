import * as React from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

import { cn } from '@/lib/utils';

type Tone = 'info' | 'error' | 'success';

const TONES: Record<Tone, { className: string; Icon: typeof Info }> = {
  info: { className: 'border-border bg-muted text-foreground', Icon: Info },
  error: { className: 'border-destructive/30 bg-destructive/5 text-destructive', Icon: AlertCircle },
  success: { className: 'border-success/30 bg-success/5 text-success', Icon: CheckCircle2 },
};

export function Alert({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn('flex gap-3 rounded-lg border p-3 text-sm', toneClass, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-sm opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
