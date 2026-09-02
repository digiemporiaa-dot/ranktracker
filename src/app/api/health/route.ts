import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { hasDataForSeoCredentials } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe.
 *
 * Reports whether the database is reachable and whether SERP credentials are
 * present — never the credentials themselves.
 */
export async function GET() {
  let database = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    database = true;
  } catch {
    database = false;
  }

  return NextResponse.json(
    {
      status: database ? 'ok' : 'degraded',
      database,
      serpProviderConfigured: hasDataForSeoCredentials(),
      timestamp: new Date().toISOString(),
    },
    { status: database ? 200 : 503 },
  );
}
