import { describe, expect, it } from 'vitest';

import {
  calculatePositionChange,
  calculateStats,
  formatPosition,
  matchesFilter,
} from '@/lib/ranking';

describe('calculatePositionChange', () => {
  it('reports an improvement when the position moves toward #1 (10 -> 5 = +5)', () => {
    const change = calculatePositionChange(5, 10);
    expect(change.kind).toBe('up');
    expect(change.delta).toBe(5);
    expect(change.label).toBe('↑ 5');
  });

  it('reports a drop when the position moves away from #1 (5 -> 10 = -5)', () => {
    const change = calculatePositionChange(10, 5);
    expect(change.kind).toBe('down');
    expect(change.delta).toBe(-5);
    expect(change.label).toBe('↓ 5');
  });

  it('reports no change when the position is the same (5 -> 5 = 0)', () => {
    const change = calculatePositionChange(5, 5);
    expect(change.kind).toBe('same');
    expect(change.delta).toBe(0);
    expect(change.label).toBe('—');
  });

  it('reports New when the keyword was not found before (Not Found -> 5)', () => {
    const change = calculatePositionChange(5, null);
    expect(change.kind).toBe('new');
    expect(change.delta).toBeNull();
    expect(change.label).toBe('New');
  });

  it('reports Lost when the keyword drops out of results (5 -> Not Found)', () => {
    const change = calculatePositionChange(null, 5);
    expect(change.kind).toBe('lost');
    expect(change.delta).toBeNull();
    expect(change.label).toBe('Lost');
  });

  it('reports nothing when both checks found nothing', () => {
    const change = calculatePositionChange(null, null);
    expect(change.kind).toBe('none');
    expect(change.label).toBe('—');
  });

  it('treats undefined the same as null', () => {
    expect(calculatePositionChange(5, undefined).kind).toBe('new');
    expect(calculatePositionChange(undefined, 5).kind).toBe('lost');
    expect(calculatePositionChange(undefined, undefined).kind).toBe('none');
  });

  it('handles moves at the edges of the result set', () => {
    expect(calculatePositionChange(1, 100).delta).toBe(99);
    expect(calculatePositionChange(100, 1).delta).toBe(-99);
  });
});

describe('formatPosition', () => {
  it('prefixes a number with # and shows Not Found for null', () => {
    expect(formatPosition(1)).toBe('#1');
    expect(formatPosition(100)).toBe('#100');
    expect(formatPosition(null)).toBe('Not Found');
    expect(formatPosition(undefined)).toBe('Not Found');
  });
});

describe('calculateStats', () => {
  it('computes every bucket from the rows', () => {
    const stats = calculateStats([
      { position: 1, previousPosition: 4 },
      { position: 2, previousPosition: 2 },
      { position: 3, previousPosition: null },
      { position: 8, previousPosition: 5 },
      { position: 15, previousPosition: 15 },
      { position: 45, previousPosition: 60 },
      { position: 99, previousPosition: null },
      { position: null, previousPosition: 7 },
      { position: null, previousPosition: null },
    ]);

    expect(stats.totalKeywords).toBe(9);
    expect(stats.top3).toBe(3);
    expect(stats.top10).toBe(4);
    expect(stats.top20).toBe(5);
    expect(stats.top50).toBe(6);
    expect(stats.top100).toBe(7);
    expect(stats.notRanking).toBe(2);
    // up: 1<-4, 45<-60 ; new: 3, 99
    expect(stats.improved).toBe(4);
    // down: 8<-5 ; lost: null<-7
    expect(stats.dropped).toBe(2);
  });

  it('is empty-safe', () => {
    const stats = calculateStats([]);
    expect(stats.totalKeywords).toBe(0);
    expect(stats.top3).toBe(0);
    expect(stats.notRanking).toBe(0);
    expect(stats.averagePosition).toBeNull();
  });

  it('averages only the ranking keywords', () => {
    const stats = calculateStats([
      { position: 2, previousPosition: null },
      { position: 4, previousPosition: null },
      { position: null, previousPosition: null },
    ]);
    expect(stats.averagePosition).toBe(3);
  });
});

describe('matchesFilter', () => {
  it('filters by position bucket', () => {
    expect(matchesFilter('top3', 3, 'same')).toBe(true);
    expect(matchesFilter('top3', 4, 'same')).toBe(false);
    expect(matchesFilter('top10', 10, 'same')).toBe(true);
    expect(matchesFilter('top100', 100, 'same')).toBe(true);
    expect(matchesFilter('top100', null, 'none')).toBe(false);
  });

  it('filters not-ranking keywords', () => {
    expect(matchesFilter('notRanking', null, 'none')).toBe(true);
    expect(matchesFilter('notRanking', 5, 'same')).toBe(false);
  });

  it('treats New as improved and Lost as dropped', () => {
    expect(matchesFilter('improved', 5, 'new')).toBe(true);
    expect(matchesFilter('improved', 5, 'up')).toBe(true);
    expect(matchesFilter('improved', 5, 'down')).toBe(false);
    expect(matchesFilter('dropped', null, 'lost')).toBe(true);
    expect(matchesFilter('dropped', 9, 'down')).toBe(true);
    expect(matchesFilter('dropped', 9, 'up')).toBe(false);
  });

  it('passes everything through for "all"', () => {
    expect(matchesFilter('all', null, 'none')).toBe(true);
    expect(matchesFilter('all', 1, 'up')).toBe(true);
  });
});
