/**
 * Location targeting and per-device tracking, end to end against a real
 * database.
 *
 * Only DataForSEO's HTTP calls are stubbed. Everything else is the real path:
 * the project routes, the city resolver and its cache, the keyword expansion
 * across devices, the ranking runner, and the rows it writes.
 *
 * What this file is really asserting is that nothing is ever mixed — a mobile
 * position never lands on a desktop history, a city result never lands on a
 * country one, and no ranking is ever recorded without saying where and on
 * what it was measured.
 *
 * Skipped unless INTEGRATION_DATABASE_URL is set.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';

const INTEGRATION_URL = process.env.INTEGRATION_DATABASE_URL;
const describeIf = INTEGRATION_URL ? describe : describe.skip;

const SESSION_SECRET = 'integration-session-secret-long-enough-for-zod';

let activeToken = '';

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'ort_session' && activeToken ? { name, value: activeToken } : undefined,
    set: () => undefined,
  }),
}));

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const jsonRequest = (body: unknown, method = 'POST') =>
  new Request('http://localhost/test', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

/** Location codes are the provider's; these are the ones the stub reports. */
const INDIA = 2356;
const NEW_DELHI = 9061259;
const MUMBAI = 9061260;

const LOCATION_ROWS = [
  { location_code: INDIA, location_name: 'India', country_iso_code: 'IN', location_type: 'Country' },
  {
    location_code: NEW_DELHI,
    location_name: 'New Delhi,Delhi,India',
    country_iso_code: 'IN',
    location_type: 'City',
  },
  {
    location_code: MUMBAI,
    location_name: 'Mumbai,Maharashtra,India',
    country_iso_code: 'IN',
    location_type: 'City',
  },
  {
    location_code: 21132,
    location_name: 'Delhi,India',
    country_iso_code: 'IN',
    location_type: 'Region',
  },
];

/** Every task body the stub was asked to run, in order. */
type SerpCall = {
  keyword: string;
  location_code: number;
  device: string;
  se_domain: string;
  language_code: string;
};

describeIf('location targeting and device tracking (integration)', () => {
  let prisma: import('@prisma/client').PrismaClient;
  let projectsRoute: typeof import('@/app/api/projects/route');
  let projectRoute: typeof import('@/app/api/projects/[id]/route');
  let keywordRoutes: typeof import('@/app/api/projects/[id]/keywords/route');
  let rateLimits: typeof import('@/lib/rate-limit');

  const OWNER = 'loc-owner@test.local';
  const DOMAIN = 'wroffy.com';

  let userId = '';

  let serpCalls: SerpCall[] = [];
  let locationCalls: string[] = [];

  /**
   * One stub for both endpoints the app talks to: the reference location list
   * (a GET) and the live SERP endpoint (a POST carrying a task array).
   *
   * `positions` decides where the tracked domain lands for a given
   * keyword+device, so a test can give desktop and mobile deliberately
   * different answers and then prove they stayed apart.
   */
  function stubProvider(positions: Record<string, number | null> = {}) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        const path = String(url);

        if (path.includes('/v3/serp/google/locations')) {
          locationCalls.push(path);
          return {
            ok: true,
            status: 200,
            json: async () => ({ status_code: 20000, tasks: [{ result: LOCATION_ROWS }] }),
          } as unknown as Response;
        }

        const [task] = JSON.parse(String(init?.body)) as SerpCall[];
        serpCalls.push(task);

        const key = `${task.keyword}|${task.device}|${task.location_code}`;
        const position = key in positions ? positions[key] : 1;

        // Filler results, with the tracked domain dropped in at `position`.
        const items = Array.from({ length: 10 }, (_, index) => ({
          type: 'organic',
          rank_absolute: index + 1,
          rank_group: index + 1,
          url:
            position !== null && index + 1 === position
              ? `https://${DOMAIN}/x`
              : `https://other-${index}.com/x`,
          domain: position !== null && index + 1 === position ? DOMAIN : `other-${index}.com`,
        }));

        return {
          ok: true,
          status: 200,
          json: async () => ({ status_code: 20000, tasks: [{ result: [{ items }] }] }),
        } as unknown as Response;
      }),
    );
  }

  async function issueSession(id: string): Promise<string> {
    const token = randomBytes(24).toString('base64url');
    await prisma.session.create({
      data: {
        userId: id,
        tokenHash: createHmac('sha256', SESSION_SECRET).update(token).digest('hex'),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });
    return token;
  }

  /** Create a project through the real route and return the saved row. */
  async function createProject(body: Record<string, unknown>) {
    const response = await projectsRoute.POST(jsonRequest(body));
    const data = await response.json();
    return { status: response.status, data };
  }

  /** Run a check over a project's keywords and wait for it to finish. */
  async function runCheck(projectId: string) {
    const { startRankCheck } = await import('@/lib/rank-check');

    const keywords = await prisma.keyword.findMany({
      where: { projectId, active: true },
      select: {
        id: true,
        keyword: true,
        targetUrl: true,
        country: true,
        city: true,
        locationCode: true,
        googleDomain: true,
        language: true,
        device: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const rankCheckId = await startRankCheck({
      project: { id: projectId, domain: DOMAIN, userId },
      keywords,
      depth: 10,
      requestId: 'integration-location',
    });

    for (let i = 0; i < 100; i += 1) {
      const check = await prisma.rankCheck.findUnique({ where: { id: rankCheckId } });
      if (check && ['COMPLETED', 'PARTIAL', 'FAILED'].includes(check.status)) return check;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('rank check did not finish in time');
  }

  beforeAll(async () => {
    process.env.DATABASE_URL = INTEGRATION_URL;
    process.env.SESSION_SECRET = SESSION_SECRET;
    process.env.DATAFORSEO_LOGIN = 'x';
    process.env.DATAFORSEO_PASSWORD = 'x';
    // Caching a SERP would hide the second device's request, which is exactly
    // what these tests are checking for.
    process.env.SERP_CACHE_MINUTES = '0';

    vi.resetModules();
    const { PrismaClient } = await import('@prisma/client');
    prisma = new PrismaClient();

    projectsRoute = await import('@/app/api/projects/route');
    projectRoute = await import('@/app/api/projects/[id]/route');
    keywordRoutes = await import('@/app/api/projects/[id]/keywords/route');
    rateLimits = await import('@/lib/rate-limit');

    await prisma.user.deleteMany({ where: { email: OWNER } });
    const user = await prisma.user.create({
      data: { email: OWNER, name: 'Loc Owner', passwordHash: 'x', role: 'EXECUTIVE' },
    });
    userId = user.id;
    activeToken = await issueSession(user.id);
  });

  beforeEach(async () => {
    rateLimits.__resetRateLimits();
    serpCalls = [];
    locationCalls = [];
    await prisma.project.deleteMany({ where: { userId } });
    // The city list is cached; each test starts from a cold one.
    await prisma.serpCache.deleteMany({});
    stubProvider();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.user.deleteMany({ where: { email: OWNER } });
      await prisma.serpCache.deleteMany({});
      await prisma.$disconnect();
    }
  });

  // ---------------------------------------------------------------- location

  describe('creating a project', () => {
    it('resolves a country on its own without asking the provider', async () => {
      const { status, data } = await createProject({
        name: 'Country only',
        domain: DOMAIN,
        country: 'IN',
      });

      expect(status).toBe(201);
      expect(data.project).toMatchObject({
        country: 'IN',
        city: null,
        locationCode: INDIA,
        googleDomain: 'google.co.in',
      });

      // Country-level tracking must keep working when the provider is down.
      expect(locationCalls).toHaveLength(0);
    });

    it('resolves a city to its own location id', async () => {
      const { status, data } = await createProject({
        name: 'City level',
        domain: DOMAIN,
        country: 'IN',
        city: 'New Delhi,Delhi',
      });

      expect(status).toBe(201);
      expect(data.project).toMatchObject({
        country: 'IN',
        city: 'New Delhi,Delhi',
        locationCode: NEW_DELHI,
        googleDomain: 'google.co.in',
      });
      expect(data.project.locationCode).not.toBe(INDIA);
    });

    it('resolves a city typed without its region, when it is unambiguous', async () => {
      const { status, data } = await createProject({
        name: 'Short city',
        domain: DOMAIN,
        country: 'IN',
        city: 'mumbai',
      });

      expect(status).toBe(201);
      expect(data.project.locationCode).toBe(MUMBAI);
      // Stored under the provider's own name, not what was typed.
      expect(data.project.city).toBe('Mumbai,Maharashtra');
    });

    it('ignores a city row with no usable location id', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          expect(String(url)).toContain('/v3/serp/google/locations');
          return {
            ok: true,
            status: 200,
            json: async () => ({
              status_code: 20000,
              tasks: [
                {
                  result: [
                    {
                      location_code: null,
                      location_name: 'Broken,India',
                      country_iso_code: 'IN',
                      location_type: 'City',
                    },
                  ],
                },
              ],
            }),
          } as unknown as Response;
        }),
      );

      // Number(null) is 0 — finite, but not a place. It must not be offered
      // and must not end up being searched.
      const { status } = await createProject({
        name: 'Broken row',
        domain: DOMAIN,
        country: 'IN',
        city: 'Broken',
      });

      expect(status).toBe(400);
      expect(await prisma.project.count({ where: { userId, name: 'Broken row' } })).toBe(0);
    });

    it('refuses a city the provider does not know, and creates nothing', async () => {
      const { status } = await createProject({
        name: 'Bad city',
        domain: DOMAIN,
        country: 'IN',
        city: 'Atlantis',
      });

      expect(status).toBe(400);
      expect(await prisma.project.count({ where: { userId, name: 'Bad city' } })).toBe(0);
    });

    it('offers only cities, never regions or the country row', async () => {
      const { status } = await createProject({
        name: 'Region',
        domain: DOMAIN,
        country: 'IN',
        // A region in the provider's list. It is not a city, so it is not one
        // of the options.
        city: 'Delhi,India',
      });

      expect(status).toBe(400);
    });

    it('requires a country', async () => {
      expect((await createProject({ name: 'No country', domain: DOMAIN })).status).toBe(400);
      expect(
        (await createProject({ name: 'City only', domain: DOMAIN, city: 'New Delhi,Delhi' }))
          .status,
      ).toBe(400);
    });

    it('requires at least one device, and refuses an unknown one', async () => {
      expect(
        (await createProject({ name: 'No device', domain: DOMAIN, country: 'IN', devices: [] }))
          .status,
      ).toBe(400);
      expect(
        (
          await createProject({
            name: 'Bad device',
            domain: DOMAIN,
            country: 'IN',
            devices: ['TABLET'],
          })
        ).status,
      ).toBe(400);
    });

    it('ignores a location id sent by the caller', async () => {
      const { data } = await createProject({
        name: 'Forged',
        domain: DOMAIN,
        country: 'IN',
        // Someone trying to search the United States from an India project.
        locationCode: 2840,
        googleDomain: 'google.com',
      });

      expect(data.project.locationCode).toBe(INDIA);
      expect(data.project.googleDomain).toBe('google.co.in');
    });

    it('caches the city list rather than asking again for every project', async () => {
      await createProject({ name: 'A', domain: DOMAIN, country: 'IN', city: 'Mumbai' });
      const afterFirst = locationCalls.length;
      await createProject({ name: 'B', domain: DOMAIN, country: 'IN', city: 'New Delhi,Delhi' });

      expect(afterFirst).toBeGreaterThan(0);
      expect(locationCalls).toHaveLength(afterFirst);
    });
  });

  describe('editing a project', () => {
    it('re-resolves the location when the city changes', async () => {
      const { data } = await createProject({ name: 'Editable', domain: DOMAIN, country: 'IN' });

      const response = await projectRoute.PATCH(
        jsonRequest({ city: 'New Delhi,Delhi' }, 'PATCH'),
        params(data.project.id),
      );

      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: data.project.id } });
      expect(saved).toMatchObject({ city: 'New Delhi,Delhi', locationCode: NEW_DELHI });
    });

    it('drops back to country level when the city is cleared', async () => {
      const { data } = await createProject({
        name: 'Clearable',
        domain: DOMAIN,
        country: 'IN',
        city: 'Mumbai',
      });

      await projectRoute.PATCH(jsonRequest({ city: null }, 'PATCH'), params(data.project.id));

      const saved = await prisma.project.findUnique({ where: { id: data.project.id } });
      expect(saved).toMatchObject({ city: null, locationCode: INDIA });
    });

    it('does not ask the provider again when the location has not changed', async () => {
      const { data } = await createProject({
        name: 'Unchanged',
        domain: DOMAIN,
        country: 'IN',
        city: 'New Delhi,Delhi',
      });

      locationCalls = [];

      // Exactly what the edit dialog sends for a rename: the location fields
      // come along untouched.
      const response = await projectRoute.PATCH(
        jsonRequest(
          {
            name: 'Unchanged Renamed',
            country: 'IN',
            city: 'New Delhi,Delhi',
            language: 'en',
            devices: ['DESKTOP'],
          },
          'PATCH',
        ),
        params(data.project.id),
      );

      expect(response.status).toBe(200);
      expect(locationCalls).toHaveLength(0);

      const saved = await prisma.project.findUnique({ where: { id: data.project.id } });
      expect(saved).toMatchObject({
        name: 'Unchanged Renamed',
        city: 'New Delhi,Delhi',
        locationCode: NEW_DELHI,
      });
    });

    it('renames a city-level project even when the provider is unreachable', async () => {
      const { data } = await createProject({
        name: 'Offline rename',
        domain: DOMAIN,
        country: 'IN',
        city: 'Mumbai',
      });

      // The provider goes away entirely.
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('ECONNREFUSED');
        }),
      );

      const response = await projectRoute.PATCH(
        jsonRequest(
          { name: 'Renamed offline', country: 'IN', city: 'Mumbai,Maharashtra' },
          'PATCH',
        ),
        params(data.project.id),
      );

      // An edit that changes no location must not depend on the provider.
      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: data.project.id } });
      expect(saved).toMatchObject({ name: 'Renamed offline', locationCode: MUMBAI });
    });

    it('changing the country does not carry a city that does not exist there', async () => {
      const { data } = await createProject({
        name: 'Moving',
        domain: DOMAIN,
        country: 'IN',
        city: 'Mumbai',
      });

      const response = await projectRoute.PATCH(
        jsonRequest({ country: 'US' }, 'PATCH'),
        params(data.project.id),
      );

      expect(response.status).toBe(200);
      const saved = await prisma.project.findUnique({ where: { id: data.project.id } });
      expect(saved).toMatchObject({
        country: 'US',
        city: null,
        locationCode: 2840,
        googleDomain: 'google.com',
      });
    });
  });

  // ------------------------------------------------------------------ devices

  describe('adding keywords', () => {
    async function projectWith(devices: string[], city?: string) {
      const { data } = await createProject({
        name: `Project ${devices.join('-')}${city ?? ''}`,
        domain: DOMAIN,
        country: 'IN',
        ...(city ? { city } : {}),
        devices,
      });
      return data.project.id as string;
    }

    it('creates one row per device, sharing one location', async () => {
      const projectId = await projectWith(['DESKTOP', 'MOBILE']);

      const response = await keywordRoutes.POST(
        jsonRequest({ text: 'autodesk reseller\nautocad reseller' }),
        params(projectId),
      );

      expect(response.status).toBe(201);
      expect((await response.json()).created).toBe(4);

      const keywords = await prisma.keyword.findMany({
        where: { projectId },
        orderBy: [{ keyword: 'asc' }, { device: 'asc' }],
      });

      expect(keywords).toHaveLength(4);
      expect(keywords.map((k) => `${k.keyword}/${k.device}`)).toEqual([
        'autocad reseller/DESKTOP',
        'autocad reseller/MOBILE',
        'autodesk reseller/DESKTOP',
        'autodesk reseller/MOBILE',
      ]);
      for (const keyword of keywords) {
        expect(keyword.locationCode).toBe(INDIA);
        expect(keyword.googleDomain).toBe('google.co.in');
      }
    });

    it('creates one row when only one device is tracked', async () => {
      const projectId = await projectWith(['MOBILE']);
      await keywordRoutes.POST(jsonRequest({ text: 'autodesk reseller' }), params(projectId));

      const keywords = await prisma.keyword.findMany({ where: { projectId } });
      expect(keywords).toHaveLength(1);
      expect(keywords[0].device).toBe('MOBILE');
    });

    it('adds a device to an existing keyword without disturbing the other', async () => {
      const projectId = await projectWith(['DESKTOP']);
      await keywordRoutes.POST(jsonRequest({ text: 'autodesk reseller' }), params(projectId));

      const before = await prisma.keyword.findFirstOrThrow({ where: { projectId } });

      const response = await keywordRoutes.POST(
        jsonRequest({ text: 'autodesk reseller', devices: ['DESKTOP', 'MOBILE'] }),
        params(projectId),
      );

      // Only the mobile row is new; the desktop row is left exactly as it was.
      expect((await response.json()).created).toBe(1);

      const after = await prisma.keyword.findMany({ where: { projectId } });
      expect(after).toHaveLength(2);
      expect(after.find((k) => k.device === 'DESKTOP')?.id).toBe(before.id);
    });

    it('keeps the same keyword separate in a different location', async () => {
      const projectId = await projectWith(['DESKTOP']);
      await keywordRoutes.POST(jsonRequest({ text: 'autodesk reseller' }), params(projectId));

      const response = await keywordRoutes.POST(
        jsonRequest({ text: 'autodesk reseller', city: 'New Delhi,Delhi' }),
        params(projectId),
      );

      expect((await response.json()).created).toBe(1);

      const keywords = await prisma.keyword.findMany({ where: { projectId } });
      expect(keywords).toHaveLength(2);
      expect(keywords.map((k) => k.locationCode).sort()).toEqual([INDIA, NEW_DELHI]);
    });
  });

  // ------------------------------------------------------------------ ranking

  describe('running a check', () => {
    async function setup(devices: string[], city?: string) {
      const { data } = await createProject({
        name: `Check ${devices.join('-')}${city ?? ''}`,
        domain: DOMAIN,
        country: 'IN',
        ...(city ? { city } : {}),
        devices,
      });
      await keywordRoutes.POST(
        jsonRequest({ text: 'autodesk reseller' }),
        params(data.project.id),
      );
      return data.project.id as string;
    }

    it('sends one request per device, with the right device parameter', async () => {
      const projectId = await setup(['DESKTOP', 'MOBILE']);
      serpCalls = [];

      const check = await runCheck(projectId);
      expect(check.status).toBe('COMPLETED');

      expect(serpCalls).toHaveLength(2);
      expect(serpCalls.map((call) => call.device).sort()).toEqual(['desktop', 'mobile']);
      // Both asked about the same keyword and place — only the device differs.
      for (const call of serpCalls) {
        expect(call.keyword).toBe('autodesk reseller');
        expect(call.location_code).toBe(INDIA);
        expect(call.se_domain).toBe('google.co.in');
      }
    });

    it('sends the country location code when no city was chosen', async () => {
      const projectId = await setup(['DESKTOP']);
      serpCalls = [];

      await runCheck(projectId);

      expect(serpCalls).toHaveLength(1);
      expect(serpCalls[0].location_code).toBe(INDIA);
    });

    it('sends the city location code when a city was chosen', async () => {
      const projectId = await setup(['DESKTOP'], 'New Delhi,Delhi');
      serpCalls = [];

      await runCheck(projectId);

      expect(serpCalls).toHaveLength(1);
      expect(serpCalls[0].location_code).toBe(NEW_DELHI);
      expect(serpCalls[0].location_code).not.toBe(INDIA);
    });

    it('records the device and the location on every ranking it writes', async () => {
      const projectId = await setup(['DESKTOP', 'MOBILE']);
      await runCheck(projectId);

      const rankings = await prisma.ranking.findMany({
        where: { keyword: { projectId } },
        include: { keyword: true },
      });

      expect(rankings).toHaveLength(2);
      for (const ranking of rankings) {
        expect(ranking.device).toBe(ranking.keyword.device);
        expect(ranking.locationCode).toBe(INDIA);
        expect(ranking.googleDomain).toBe('google.co.in');
      }
    });

    it('keeps a mobile position off the desktop history', async () => {
      const projectId = await setup(['DESKTOP', 'MOBILE']);

      // Deliberately different answers per device.
      stubProvider({
        'autodesk reseller|desktop|2356': 7,
        'autodesk reseller|mobile|2356': 4,
      });

      await runCheck(projectId);

      const desktop = await prisma.keyword.findFirstOrThrow({
        where: { projectId, device: 'DESKTOP' },
        include: { rankings: true },
      });
      const mobile = await prisma.keyword.findFirstOrThrow({
        where: { projectId, device: 'MOBILE' },
        include: { rankings: true },
      });

      expect(desktop.rankings.map((r) => r.position)).toEqual([7]);
      expect(mobile.rankings.map((r) => r.position)).toEqual([4]);
    });

    it('builds a separate history per device over repeated checks', async () => {
      const projectId = await setup(['DESKTOP', 'MOBILE']);

      // Positions stay within the stubbed result depth of 10.
      stubProvider({
        'autodesk reseller|desktop|2356': 9,
        'autodesk reseller|mobile|2356': 6,
      });
      await runCheck(projectId);

      stubProvider({
        'autodesk reseller|desktop|2356': 7,
        'autodesk reseller|mobile|2356': 4,
      });
      await runCheck(projectId);

      const desktop = await prisma.keyword.findFirstOrThrow({
        where: { projectId, device: 'DESKTOP' },
        include: { rankings: { orderBy: { checkedAt: 'asc' } } },
      });
      const mobile = await prisma.keyword.findFirstOrThrow({
        where: { projectId, device: 'MOBILE' },
        include: { rankings: { orderBy: { checkedAt: 'asc' } } },
      });

      // Two runs, two rows each, and neither series contains the other's.
      expect(desktop.rankings.map((r) => r.position)).toEqual([9, 7]);
      expect(mobile.rankings.map((r) => r.position)).toEqual([6, 4]);
      expect(desktop.rankings.every((r) => r.device === 'DESKTOP')).toBe(true);
      expect(mobile.rankings.every((r) => r.device === 'MOBILE')).toBe(true);
    });

    it('computes the change within a device, never across the two', async () => {
      const projectId = await setup(['DESKTOP', 'MOBILE']);

      stubProvider({
        'autodesk reseller|desktop|2356': 9,
        'autodesk reseller|mobile|2356': 10,
      });
      await runCheck(projectId);

      stubProvider({
        'autodesk reseller|desktop|2356': 4,
        'autodesk reseller|mobile|2356': 8,
      });
      await runCheck(projectId);

      const { decorate, getKeywordRows } = await import('@/lib/queries');
      const rows = decorate(await getKeywordRows(projectId));

      const desktop = rows.find((r) => r.device === 'DESKTOP');
      const mobile = rows.find((r) => r.device === 'MOBILE');

      // Desktop 9 -> 4 is +5 against its own previous reading, not against
      // mobile's 10; mobile 10 -> 8 is +2 against its own.
      expect(desktop).toMatchObject({ position: 4, previousPosition: 9, changeDelta: 5 });
      expect(mobile).toMatchObject({ position: 8, previousPosition: 10, changeDelta: 2 });
    });

    it('never lets a new location overwrite an older location history', async () => {
      const projectId = await setup(['DESKTOP']);

      stubProvider({ 'autodesk reseller|desktop|2356': 8 });
      await runCheck(projectId);

      // The project moves to a city, and the same keyword is added again.
      await projectRoute.PATCH(
        jsonRequest({ city: 'New Delhi,Delhi' }, 'PATCH'),
        params(projectId),
      );
      await keywordRoutes.POST(jsonRequest({ text: 'autodesk reseller' }), params(projectId));

      stubProvider({
        'autodesk reseller|desktop|2356': 8,
        [`autodesk reseller|desktop|${NEW_DELHI}`]: 2,
      });
      await runCheck(projectId);

      const nationwide = await prisma.keyword.findFirstOrThrow({
        where: { projectId, locationCode: INDIA },
        include: { rankings: { orderBy: { checkedAt: 'asc' } } },
      });
      const delhi = await prisma.keyword.findFirstOrThrow({
        where: { projectId, locationCode: NEW_DELHI },
        include: { rankings: true },
      });

      // The nationwide keyword kept its own history and gained its own second
      // reading; Delhi's #2 went nowhere near it.
      expect(nationwide.rankings.map((r) => r.position)).toEqual([8, 8]);
      expect(delhi.rankings.map((r) => r.position)).toEqual([2]);
      expect(nationwide.rankings.every((r) => r.locationCode === INDIA)).toBe(true);
    });

    it('does not serve one device a SERP cached for the other', async () => {
      // With caching on, the cache key still has to keep the two apart.
      process.env.SERP_CACHE_MINUTES = '60';
      vi.resetModules();

      try {
        const projectId = await setup(['DESKTOP', 'MOBILE']);
        serpCalls = [];

        await runCheck(projectId);

        expect(serpCalls).toHaveLength(2);
        expect(serpCalls.map((call) => call.device).sort()).toEqual(['desktop', 'mobile']);
      } finally {
        process.env.SERP_CACHE_MINUTES = '0';
        vi.resetModules();
      }
    });
  });
});
