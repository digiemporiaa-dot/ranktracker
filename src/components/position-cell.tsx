import { AlertTriangle, ArrowDown, ArrowUp, Minus, Sparkles, TrendingDown } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { ChangeKind } from '@/lib/ranking';
import { isMeasuredSerpStatus } from '@/config/serp';

/**
 * A position, or an honest account of why there is not one.
 *
 * `position` is the last *measured* position and `serpStatus` is the outcome of
 * the last attempt, which can be later. When the last attempt could not read
 * the SERP the two disagree, and saying so is the point: a keyword at #7 whose
 * latest check came back 40102 shows #7 with a warning, never "Not Found".
 */
export function PositionCell({
  position,
  serpStatus,
}: {
  position: number | null;
  serpStatus?: string | null;
}) {
  const attemptFailed = serpStatus != null && !isMeasuredSerpStatus(serpStatus);

  if (position === null) {
    if (attemptFailed) {
      return (
        <span
          className="inline-flex items-center gap-1 text-sm text-warning"
          title={
            serpStatus === 'SERP_UNAVAILABLE'
              ? 'The search provider returned no results page for this keyword. This is not a ranking — run the check again.'
              : 'The ranking check could not be completed. This is not a ranking — run the check again.'
          }
        >
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {serpStatus === 'SERP_UNAVAILABLE' ? 'SERP unavailable' : 'Check failed'}
        </span>
      );
    }
    return <span className="text-sm text-muted-foreground">Not Found</span>;
  }

  const tone =
    position <= 3
      ? 'bg-success/10 text-success'
      : position <= 10
        ? 'bg-primary/10 text-primary'
        : 'bg-secondary text-secondary-foreground';

  return (
    <span className="inline-flex items-center gap-1">
      <span
        className={cn(
          'inline-flex min-w-[3rem] items-center justify-center rounded-md px-2 py-1 text-sm font-semibold tabular-nums',
          tone,
        )}
      >
        #{position}
      </span>
      {attemptFailed ? (
        <AlertTriangle
          className="h-3.5 w-3.5 shrink-0 text-warning"
          aria-label="The latest check could not read the SERP. This is the last position we actually measured."
        />
      ) : null}
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
