import { redirect } from 'next/navigation';

import { getCurrentUser } from '@/lib/auth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AuthForm } from '@/components/auth-form';

export const metadata = { title: 'Sign in · OurRankTracker' };

export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  if (await getCurrentUser()) redirect('/dashboard');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in</CardTitle>
        <CardDescription>Welcome back. Enter your details to continue.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <AuthForm />
        <p className="text-center text-sm text-muted-foreground">
          Accounts are created by an administrator.
        </p>
      </CardContent>
    </Card>
  );
}
