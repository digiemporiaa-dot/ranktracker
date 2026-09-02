import { requireUser } from '@/lib/api';
import { env, hasDataForSeoCredentials } from '@/lib/env';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/page-header';
import { COUNTRIES, COUNTRY_CODES, DEPTH_OPTIONS, LANGUAGES, LANGUAGE_CODES } from '@/config/serp';

export const metadata = { title: 'Settings · OurRankTracker' };
export const dynamic = 'force-dynamic';

/**
 * Read-only settings.
 *
 * Provider credentials are deliberately not shown or editable here — they are
 * server environment variables and never reach the browser. Only whether they
 * are configured is reported.
 */
export default async function SettingsPage() {
  const user = await requireUser();
  const configured = hasDataForSeoCredentials();

  return (
    <>
      <PageHeader title="Settings" description="Your account and this instance's configuration." />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Name</dt>
                <dd className="font-medium">{user.name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Email</dt>
                <dd className="truncate font-medium">{user.email}</dd>
              </div>
              {user.isDemo ? (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">Account type</dt>
                  <dd>
                    <Badge variant="secondary">Demo</Badge>
                  </dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>SERP provider</CardTitle>
            <CardDescription>
              Rankings come from DataForSEO, called from this server only.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Credentials</dt>
                <dd>
                  {configured ? (
                    <Badge variant="success">Configured</Badge>
                  ) : (
                    <Badge variant="destructive">Not configured</Badge>
                  )}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Results per check</dt>
                <dd className="font-medium tabular-nums">{env.SERP_RESULTS}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Concurrency</dt>
                <dd className="font-medium tabular-nums">{env.SERP_CONCURRENCY}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Max keywords per check</dt>
                <dd className="font-medium tabular-nums">{env.MAX_KEYWORDS_PER_CHECK}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Cache</dt>
                <dd className="font-medium tabular-nums">{env.SERP_CACHE_MINUTES} minutes</dd>
              </div>
            </dl>
            <p className="mt-4 text-xs text-muted-foreground">
              Credentials are read from server environment variables and are never sent to the
              browser. Change them where this application is deployed.
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Supported countries</CardTitle>
            <CardDescription>Available when creating a project.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-1.5">
            {COUNTRY_CODES.map((code) => (
              <Badge key={code} variant="outline">
                {COUNTRIES[code].label}
              </Badge>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Languages and depth</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {LANGUAGE_CODES.map((code) => (
                <Badge key={code} variant="outline">
                  {LANGUAGES[code].label}
                </Badge>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {DEPTH_OPTIONS.map((depth) => (
                <Badge key={depth} variant="outline">
                  Top {depth}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
