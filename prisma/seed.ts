/**
 * Development seed data.
 *
 * Creates a clearly-labelled demo user, project and keywords with static
 * ranking history. This never calls DataForSEO — the numbers below are
 * fabricated for local development and are marked `isDemo` so they can never
 * be mistaken for real ranking data.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

import { COUNTRIES } from '../src/config/serp';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@ourranktracker.local';
const DEMO_PASSWORD = 'demo-password-123';

const DEMO_KEYWORDS: { keyword: string; targetUrl: string | null; history: (number | null)[] }[] = [
  { keyword: 'microsoft reseller india', targetUrl: '/microsoft-reseller', history: [7, 4] },
  { keyword: 'azure reseller india', targetUrl: '/azure', history: [6, 8] },
  { keyword: 'microsoft partner india', targetUrl: null, history: [12, 12] },
  { keyword: 'microsoft 365 reseller', targetUrl: '/microsoft-365', history: [null, 15] },
  { keyword: 'office 365 partner india', targetUrl: null, history: [3, 2] },
  { keyword: 'azure cloud partner', targetUrl: '/azure', history: [24, 19] },
  { keyword: 'microsoft licensing india', targetUrl: null, history: [9, null] },
  { keyword: 'windows server license india', targetUrl: null, history: [null, null] },
  { keyword: 'microsoft csp partner india', targetUrl: '/csp', history: [1, 1] },
  { keyword: 'enterprise software reseller india', targetUrl: null, history: [56, 43] },
];

async function main() {
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: {
      email: DEMO_EMAIL,
      name: 'Demo User',
      passwordHash,
      isDemo: true,
    },
  });

  const existing = await prisma.project.findFirst({
    where: { userId: user.id, name: 'Demo Project — Wroffy India' },
  });

  // Re-running the seed replaces the demo project so history stays predictable.
  if (existing) await prisma.project.delete({ where: { id: existing.id } });

  const project = await prisma.project.create({
    data: {
      userId: user.id,
      name: 'Demo Project — Wroffy India',
      domain: 'wroffy.com',
      country: 'IN',
      city: null,
      locationCode: COUNTRIES.IN.locationCode,
      googleDomain: COUNTRIES.IN.googleDomain,
      language: 'en',
      devices: ['DESKTOP'],
      isDemo: true,
    },
  });

  // Two checks, two days apart, so the dashboard shows real position changes.
  const checkDates = [
    new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
    new Date(Date.now() - 1 * 60 * 60 * 1000),
  ];

  const rankChecks = [];
  for (const checkedAt of checkDates) {
    rankChecks.push(
      await prisma.rankCheck.create({
        data: {
          projectId: project.id,
          status: 'COMPLETED',
          totalKeywords: DEMO_KEYWORDS.length,
          completedKeywords: DEMO_KEYWORDS.length,
          failedKeywords: 0,
          startedAt: checkedAt,
          completedAt: checkedAt,
          createdAt: checkedAt,
        },
      }),
    );
  }

  for (const entry of DEMO_KEYWORDS) {
    const keyword = await prisma.keyword.create({
      data: {
        projectId: project.id,
        keyword: entry.keyword,
        targetUrl: entry.targetUrl,
        country: 'IN',
        city: null,
        locationCode: COUNTRIES.IN.locationCode,
        googleDomain: COUNTRIES.IN.googleDomain,
        language: 'en',
        device: 'DESKTOP',
      },
    });

    for (const [index, position] of entry.history.entries()) {
      await prisma.ranking.create({
        data: {
          keywordId: keyword.id,
          rankCheckId: rankChecks[index].id,
          position,
          rankingUrl:
            position === null
              ? null
              : `https://wroffy.com${entry.targetUrl ?? `/${entry.keyword.replace(/\s+/g, '-')}`}`,
          resultsChecked: 100,
          device: 'DESKTOP',
          locationCode: COUNTRIES.IN.locationCode,
          googleDomain: COUNTRIES.IN.googleDomain,
          checkedAt: checkDates[index],
          createdAt: checkDates[index],
        },
      });
    }
  }

  console.log('Seeded demo data (static, not from DataForSEO):');
  console.log(`  email:    ${DEMO_EMAIL}`);
  console.log(`  password: ${DEMO_PASSWORD}`);
  console.log(`  project:  ${project.name} (${project.domain})`);
  console.log(`  keywords: ${DEMO_KEYWORDS.length}, each with 2 ranking checks`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
