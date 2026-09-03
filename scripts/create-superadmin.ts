/**
 * Create or promote the first superadmin.
 *
 *   npm run create-superadmin -- --email you@example.com
 *
 * With public registration removed, this is the only way to create the first
 * account. It runs against DATABASE_URL, so it works in the Coolify container
 * terminal as well as locally.
 *
 * The password is typed at a prompt rather than passed as an argument, because
 * arguments land in shell history and in the process list. There is
 * deliberately no SUPERADMIN_PASSWORD environment variable either — that would
 * leave a live admin password sitting in the deployment configuration forever.
 */
import 'dotenv/config';

import { z } from 'zod';

import { prisma } from '../src/lib/db';
import { activeSuperadminCount, createUser, normalizeEmail, USER_SELECT } from '../src/lib/users';
import { hashPassword } from '../src/lib/auth';

const MIN_PASSWORD_LENGTH = 12;

const emailSchema = z.string().trim().toLowerCase().email();

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function fail(message: string): never {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

/**
 * Read a line without echoing it.
 *
 * Requires a real terminal. Refusing when stdin is a pipe is deliberate: it
 * would otherwise be possible to feed a password in from a shell command,
 * which is exactly what this prompt exists to avoid.
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') {
      fail(
        'A terminal is required so the password is never echoed.\n' +
          '  Run this directly in a shell (locally, or in the Coolify container terminal),\n' +
          '  not through a pipe or a CI job.',
      );
    }

    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';

    const finish = (result: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener('data', onData);
      process.stdout.write('\n');
      resolve(result);
    };

    function onData(chunk: string) {
      for (const char of chunk) {
        const code = char.charCodeAt(0);
        // Enter (CR/LF) or Ctrl-D ends the entry.
        if (code === 13 || code === 10 || code === 4) return finish(value);
        if (code === 3) {
          // Ctrl-C
          stdin.setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          process.exit(130);
        }
        // Backspace / delete.
        if (code === 8 || code === 127) {
          value = value.slice(0, -1);
          continue;
        }
        // Ignore other control characters, e.g. arrow-key escape sequences.
        if (code >= 32) value += char;
      }
    }

    stdin.on('data', onData);
  });
}

/** Read a visible line, for yes/no answers and the display name. */
function promptLine(question: string): Promise<string> {
  return new Promise((resolve) => {
    const stdin = process.stdin;

    if (!stdin.isTTY) {
      fail('A terminal is required. Run this directly in a shell.');
    }

    process.stdout.write(question);
    stdin.resume();
    stdin.setEncoding('utf8');

    const onData = (chunk: string) => {
      stdin.pause();
      stdin.removeListener('data', onData);
      resolve(chunk.replace(/[\r\n]+$/, '').trim());
    };

    stdin.on('data', onData);
  });
}

async function askYesNo(question: string): Promise<boolean> {
  const answer = (await promptLine(`${question} [y/N] `)).toLowerCase();
  return answer === 'y' || answer === 'yes';
}

/** Ask twice, so a typo cannot lock the account. */
async function askNewPassword(): Promise<string> {
  for (;;) {
    const password = await promptHidden(`  New password (min ${MIN_PASSWORD_LENGTH} characters): `);

    if (password.length < MIN_PASSWORD_LENGTH) {
      console.error(`  Too short — ${MIN_PASSWORD_LENGTH} characters minimum. Try again.`);
      continue;
    }

    const again = await promptHidden('  Confirm password: ');
    if (password !== again) {
      console.error('  The two entries did not match. Try again.');
      continue;
    }

    return password;
  }
}

async function main() {
  const rawEmail = arg('email');
  if (!rawEmail) {
    fail('Usage: npm run create-superadmin -- --email you@example.com [--name "Your Name"] [--force]');
  }

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) fail(`"${rawEmail}" is not a valid email address.`);
  const email = normalizeEmail(parsed.data);

  const existingSuperadmins = await activeSuperadminCount();
  const existing = await prisma.user.findUnique({
    where: { email },
    select: { ...USER_SELECT, isDemo: true },
  });

  // Refuse to quietly mint a second administrator on an established install.
  if (existingSuperadmins > 0 && !hasFlag('force') && existing?.role !== 'SUPERADMIN') {
    fail(
      `This database already has ${existingSuperadmins} active superadmin(s).\n` +
        '  Create further accounts from /admin/users, or pass --force if you are sure.',
    );
  }

  console.log('');
  console.log('  OurRankTracker — create superadmin');
  console.log(`  Database: ${process.env.DATABASE_URL ? 'from DATABASE_URL' : 'NOT CONFIGURED'}`);
  console.log(`  Email:    ${email}`);
  console.log('');

  if (existing) {
    if (existing.role === 'SUPERADMIN' && existing.isActive) {
      console.log('  That account is already an active superadmin. Nothing to do.');
      console.log('  Re-run with --force to set a new password for it.\n');
      if (!hasFlag('force')) return;
    } else {
      console.log(`  An account with that email already exists (role: ${existing.role}).`);
      if (!(await askYesNo('  Promote it to SUPERADMIN?'))) {
        console.log('\n  Cancelled. Nothing was changed.\n');
        return;
      }
    }

    const changePassword =
      hasFlag('force') || (await askYesNo('  Also set a new password for it?'));
    const password = changePassword ? await askNewPassword() : null;
    const passwordHash = password ? await hashPassword(password) : null;

    // Promotion, reactivation, the optional password and the session purge all
    // land together, so the account is never left half-updated.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: existing.id },
        data: {
          role: 'SUPERADMIN',
          isActive: true,
          ...(passwordHash ? { passwordHash } : {}),
        },
      }),
      // Any existing sessions predate the role change; make them sign in again.
      prisma.session.deleteMany({ where: { userId: existing.id } }),
    ]);

    console.log('');
    console.log(`  ${email} is now an active SUPERADMIN.`);
    if (password) console.log('  Its password was replaced and existing sessions were signed out.');
    console.log('  Sign in at /login.\n');
    return;
  }

  const name = arg('name') ?? (await promptLine('  Display name: ')) ?? '';
  if (!name.trim()) fail('A display name is required.');

  const password = await askNewPassword();

  const user = await createUser({
    email,
    name,
    password,
    role: 'SUPERADMIN',
  });

  console.log('');
  console.log(`  Created SUPERADMIN ${user.email} (${user.name}).`);
  console.log('  Sign in at /login.\n');
}

main()
  .catch((error) => {
    // Never print the error object: it can carry the connection string.
    console.error(`\n  Failed: ${error instanceof Error ? error.message : 'unknown error'}\n`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
