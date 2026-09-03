import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Public registration is gone, and must stay gone.
 *
 * This tool holds client ranking data, so an accidentally restored signup page
 * is a real problem. Next.js routes exist because a file exists, so asserting
 * the files are absent is what actually prevents one coming back — a request
 * test would only catch it after someone had already shipped the route.
 *
 * There is deliberately no ALLOW_REGISTRATION flag: a disabled flag is one
 * misconfigured environment variable away from open public signup.
 */
const root = path.resolve(import.meta.dirname, '..');

const FORBIDDEN = [
  'src/app/(auth)/register/page.tsx',
  'src/app/api/auth/register/route.ts',
];

describe('public registration', () => {
  for (const file of FORBIDDEN) {
    it(`does not ship ${file}`, () => {
      expect(existsSync(path.join(root, file))).toBe(false);
    });
  }

  it('leaves no register directory behind', () => {
    expect(existsSync(path.join(root, 'src/app/(auth)/register'))).toBe(false);
    expect(existsSync(path.join(root, 'src/app/api/auth/register'))).toBe(false);
  });

  it('is not re-enabled by an environment flag', async () => {
    const { readFileSync } = await import('node:fs');
    const env = readFileSync(path.join(root, '.env.example'), 'utf8');
    expect(env).not.toMatch(/ALLOW_REGISTRATION|ENABLE_SIGNUP|PUBLIC_SIGNUP/i);
  });

  it('the sign-in page does not link to a signup page', async () => {
    const { readFileSync } = await import('node:fs');
    const page = readFileSync(path.join(root, 'src/app/(auth)/login/page.tsx'), 'utf8');
    expect(page).not.toContain('/register');
    expect(page).toMatch(/created by an administrator/i);
  });
});
