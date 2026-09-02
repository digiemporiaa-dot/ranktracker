'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Play } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { COUNTRIES, LANGUAGES, type CountryCode, type LanguageCode } from '@/config/serp';

type CheckStatus = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  totalKeywords: number;
  completedKeywords: number;
  failedKeywords: number;
  progress: number;
  message: string | null;
};

const POLL_INTERVAL_MS = 2000;

/**
 * Starts a ranking check and polls for progress.
 *
 * The request returns as soon as the run is queued and the work continues on
 * the server, so the page stays responsive throughout.
 */
export function RankCheckButton({
  projectId,
  keywordCount,
  country,
  language,
  device,
  depth,
  activeCheckId,
}: {
  projectId: string;
  keywordCount: number;
  country: string;
  language: string;
  device: string;
  depth: number;
  activeCheckId?: string | null;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [checkId, setCheckId] = useState<string | null>(activeCheckId ?? null);
  const [status, setStatus] = useState<CheckStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const poll = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/rank-check/${id}`, { cache: 'no-store' });
        if (!response.ok) return;

        const data = (await response.json()) as CheckStatus;
        setStatus(data);

        if (data.status === 'PENDING' || data.status === 'RUNNING') {
          timer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS);
        } else {
          setCheckId(null);
          if (data.status === 'FAILED') {
            setError(data.message ?? 'The ranking check could not be completed.');
          }
          router.refresh();
        }
      } catch {
        // A dropped poll is not fatal — try again on the next tick.
        timer.current = setTimeout(() => poll(id), POLL_INTERVAL_MS * 2);
      }
    },
    [router],
  );

  useEffect(() => {
    if (!checkId) return;
    poll(checkId);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [checkId, poll]);

  async function start() {
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/projects/${projectId}/rank-check`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ depth }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'The ranking check could not be started.');
        setConfirming(false);
        return;
      }

      setConfirming(false);
      setCheckId(data.rankCheckId);
    } catch {
      setError('We could not reach the server. Please try again.');
    } finally {
      setStarting(false);
    }
  }

  const running = Boolean(checkId) && (status?.status === 'RUNNING' || status?.status === 'PENDING' || !status);

  if (running) {
    const done = (status?.completedKeywords ?? 0) + (status?.failedKeywords ?? 0);
    const total = status?.totalKeywords || keywordCount;

    return (
      <div className="w-full space-y-2 rounded-lg border border-border bg-card p-4 sm:w-80">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">Checking rankings…</p>
          <p className="text-sm tabular-nums text-muted-foreground">
            {done} / {total}
          </p>
        </div>
        <Progress value={status?.progress ?? 0} />
        <p className="text-xs tabular-nums text-muted-foreground">{status?.progress ?? 0}%</p>
      </div>
    );
  }

  if (confirming) {
    const countryLabel = COUNTRIES[country as CountryCode]?.label ?? country;
    const languageLabel = LANGUAGES[language as LanguageCode]?.label ?? language;

    return (
      <div className="w-full space-y-3 rounded-lg border border-border bg-card p-4 sm:w-80">
        <div className="space-y-1 text-sm">
          <p className="font-medium">
            {keywordCount} keyword{keywordCount === 1 ? '' : 's'}
          </p>
          <dl className="space-y-0.5 text-muted-foreground">
            <div className="flex justify-between">
              <dt>Country</dt>
              <dd className="text-foreground">{countryLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Language</dt>
              <dd className="text-foreground">{languageLabel}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Device</dt>
              <dd className="text-foreground">{device === 'MOBILE' ? 'Mobile' : 'Desktop'}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Results</dt>
              <dd className="text-foreground">{depth}</dd>
            </div>
          </dl>
        </div>
        <p className="text-sm font-medium">Start ranking check?</p>
        <div className="flex gap-2">
          <Button onClick={start} disabled={starting} className="flex-1">
            {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Start
          </Button>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={starting}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Button onClick={() => setConfirming(true)} disabled={keywordCount === 0}>
        <Play className="h-4 w-4" />
        Check Rankings
      </Button>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {status && status.status !== 'FAILED' && status.message ? (
        <Alert tone="info">{status.message}</Alert>
      ) : null}
    </div>
  );
}
