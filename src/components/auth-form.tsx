'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Loader2 } from 'lucide-react';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/**
 * The sign-in form.
 *
 * There is no sign-up counterpart: accounts are provisioned by a superadmin
 * from /admin/users, or by the create-superadmin CLI for the first one.
 */
export function AuthForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const formData = new FormData(event.currentTarget);
    const payload = Object.fromEntries(formData) as Record<string, string>;

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.');
        setPending(false);
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      setError('We could not reach the server. Please check your connection.');
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={1}
        />
      </div>

      <Button type="submit" className="w-full" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Sign in
      </Button>
    </form>
  );
}
