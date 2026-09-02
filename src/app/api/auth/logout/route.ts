import { NextResponse } from 'next/server';

import { destroySession } from '@/lib/auth';
import { route } from '@/lib/api';

export async function POST() {
  return route('POST /api/auth/logout', async () => {
    await destroySession();
    return NextResponse.json({ ok: true });
  });
}
