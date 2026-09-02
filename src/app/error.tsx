'use client';

import { useEffect } from 'react';

import { Button } from '@/components/ui/button';

/**
 * Last-resort error boundary. The underlying error is logged on the server;
 * the browser only ever sees this generic message.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(JSON.stringify({ level: 'error', message: 'client error', digest: error.digest }));
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Please try again. If the problem continues, contact your administrator.
      </p>
      <Button onClick={reset}>Try again</Button>
    </div>
  );
}
