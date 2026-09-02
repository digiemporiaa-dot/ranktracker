import { ArrowDown, ArrowUp, Minus, Sparkles, TrendingDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ChangeKind } from '@/lib/ranking';

export function PositionCell({ position }: { position: number | null }) {
  if (position === null) {
    return <span className="text-sm text-muted-foreground">Not Found</span>;
  }

  const tone =
    position <= 3
      ? 'bg-success/10 text-success'
      : position <= 10
        ? 'bg-primary/10 text-primary'
        : 'bg-secondary text-secondary-foreground';

  return (
    <span
      className={cn(
        'inline-flex min-w-[3rem] items-center justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums',
        tone,
      )}
    >
      #{position}
    </span>
  );
}

export function ChangeCell({ kind, label }: { kind: ChangeKind; label: string }) {
  const config: Record<ChangeKind, { className: string; Icon: typeof Minus | null }> = {
    up: { className: 'text-success', Icon: ArrowUp },
    down: { className: 'text-destructive', Icon: ArrowDown },
    same: { className: 'text-muted-foreground', Icon: null },
    new: { className: 'text-primary', Icon: Sparkles },
    lost: { className: 'text-destructive', Icon: TrendingDown },
    none: { className: 'text-muted-foreground', Icon: null },
  };

  const { className, Icon } = config[kind];
  // The arrow is already part of the label for up/down moves.
  const text = kind === 'up' || kind === 'down' ? label.replace(/^[↑↓]\s*/, '') : label;

  return (
    <span className={cn('inline-flex items-center gap-1 text-sm font-medium tabular-nums', className)}>
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden /> : null}
      {text}
    </span>
  );
}
