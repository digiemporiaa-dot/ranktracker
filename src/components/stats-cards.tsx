import { Card, CardContent } from '@/components/ui/card';
import type { RankingStats } from '@/lib/ranking';
import { cn } from '@/lib/utils';

const CARDS: { key: keyof RankingStats; label: string; tone?: string }[] = [
  { key: 'totalKeywords', label: 'Total Keywords' },
  { key: 'top3', label: 'Top 3', tone: 'text-success' },
  { key: 'top10', label: 'Top 10', tone: 'text-success' },
  { key: 'top20', label: 'Top 20' },
  { key: 'notRanking', label: 'Not Ranking', tone: 'text-muted-foreground' },
];

export function StatsCards({ stats }: { stats: RankingStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {CARDS.map(({ key, label, tone }) => (
        <Card key={key}>
          <CardContent className="p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </p>
            <p className={cn('mt-1.5 text-2xl font-semibold tabular-nums', tone)}>
              {stats[key] ?? 0}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
