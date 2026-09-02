# OurRankTracker

A SEO keyword rank tracker. Create a project for a website, import a keyword list,
run a ranking check, and see where you rank on Google — with position history and
change tracking over time.

Rankings come from the **DataForSEO SERP API**, called directly from the Next.js
server. There is no custom SERP API and no provider abstraction layer.

---

## Contents

- [Architecture](#architecture)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Getting started](#getting-started)
- [Environment variables](#environment-variables)
- [PostgreSQL setup](#postgresql-setup)
- [Prisma setup](#prisma-setup)
- [DataForSEO setup](#dataforseo-setup)
- [Testing](#testing)
- [Docker](#docker)
- [Coolify deployment](#coolify-deployment)
- [API routes](#api-routes)
- [How ranking detection works](#how-ranking-detection-works)
- [Security notes](#security-notes)
- [Troubleshooting](#troubleshooting)
- [Known limitations](#known-limitations)

---

## Architecture

```text
Browser
   ↓  (session cookie, HTTP-only)
Next.js Server
   ↓  (HTTP Basic, server-side only)
DataForSEO SERP API
   ↓
Google SERP
   ↓
Organic-only position detection
   ↓
PostgreSQL
   ↓
Dashboard
```

The browser never calls DataForSEO and never receives DataForSEO credentials.
Credentials are read from server-side environment variables in a module marked
`server-only`, so importing them from a Client Component is a build error.

There is deliberately **no** `/api/serp/search` route, no `SerpProvider`,
no `SerpService` and no provider abstraction.

---

## Features

- Email/password accounts with server-side sessions in HTTP-only cookies
- Projects: name, website, country, language, device
- Keyword entry by CSV upload (with a preview step) or by pasting a list
- Ranking checks against DataForSEO with bounded concurrency and live progress
- Organic-only position detection — ads and other paid elements are excluded
- Subdomain-aware domain matching that rejects lookalike domains
- Append-only ranking history; positions are never overwritten
- Position change tracking, including `New` and `Lost`
- Dashboard statistics computed from the data (Top 3 / 10 / 20, Not Ranking)
- Filtering, keyword search, and sorting on the ranking table
- CSV export with spreadsheet formula-injection protection

---

## Tech stack

| Layer      | Choice                                          |
| ---------- | ----------------------------------------------- |
| Framework  | Next.js 15 (App Router), React 19, TypeScript    |
| Styling    | Tailwind CSS 3, shadcn/ui-style components       |
| Icons      | lucide-react                                     |
| Database   | PostgreSQL 16 via Prisma 6                       |
| Validation | Zod                                              |
| Auth       | bcrypt password hashing, HMAC-hashed sessions    |
| SERP data  | DataForSEO SERP API (Google Organic Live Advanced) |
| Testing    | Vitest                                           |
| Deployment | Docker, Coolify-compatible                       |

---

## Getting started

Requirements: Node.js 22+, PostgreSQL 16+, npm.

```bash
git clone <this repository>
cd ranktracker

npm install

cp .env.example .env
# Fill in DATABASE_URL, SESSION_SECRET, and your DataForSEO credentials.
# Generate a session secret with:
openssl rand -base64 48

npx prisma migrate deploy   # create the schema
npm run seed                # optional: demo user, project and keywords

npm run dev                 # http://localhost:3000
```

Then register an account at `/register`, or sign in with the seeded demo
account (see [Seed data](#seed-data)).

### Commands

| Command                      | What it does                                          |
| ---------------------------- | ----------------------------------------------------- |
| `npm run dev`                | Development server                                    |
| `npm run build`              | Production build (runs `prisma generate` first)       |
| `npm run start`              | Serve the production build                            |
| `npm run lint`               | ESLint                                                |
| `npm test`                   | Unit tests                                            |
| `npm run test:integration`   | Integration tests (needs a database, see [Testing](#testing)) |
| `npm run seed`               | Insert demo data                                      |
| `npm run prisma:migrate`     | Create and apply a migration in development           |
| `npm run prisma:deploy`      | Apply committed migrations (production)               |
| `npm run dataforseo:check`   | Check one keyword against the live API                |
| `npm run dataforseo:locations` | Verify configured location codes against DataForSEO |

---

## Environment variables

All of these are **server-side only**. None may be prefixed with `NEXT_PUBLIC_`.

| Variable                 | Required | Default | Purpose                                                |
| ------------------------ | -------- | ------- | ------------------------------------------------------ |
| `DATABASE_URL`           | yes      | —       | PostgreSQL connection string                           |
| `SESSION_SECRET`         | yes      | —       | Signs session tokens; at least 32 characters           |
| `DATAFORSEO_LOGIN`       | for checks | —     | DataForSEO API login                                   |
| `DATAFORSEO_PASSWORD`    | for checks | —     | DataForSEO API password                                |
| `SERP_CONCURRENCY`       | no       | `3`     | Keywords checked in parallel                           |
| `MAX_KEYWORDS_PER_CHECK` | no       | `500`   | Hard cap on one ranking check                          |
| `SERP_RESULTS`           | no       | `100`   | Organic results to inspect (DataForSEO allows up to 700) |
| `SERP_CACHE_MINUTES`     | no       | `30`    | SERP cache lifetime; `0` disables caching              |

The application validates this configuration at startup and refuses to run with
an invalid one. The error names only the offending variables, never their values.

`.env` is git-ignored. Copy `.env.example` and fill it in locally.

---

## PostgreSQL setup

Any PostgreSQL 14+ instance works. Locally:

```bash
createdb ourranktracker
# DATABASE_URL=postgresql://USER@localhost:5432/ourranktracker?schema=public
```

Or use the bundled Compose service:

```bash
docker compose up -d db
# DATABASE_URL=postgresql://ourranktracker:ourranktracker@localhost:5432/ourranktracker?schema=public
```

### Data model

| Model       | Purpose                                                                 |
| ----------- | ----------------------------------------------------------------------- |
| `User`      | Account with a bcrypt password hash                                     |
| `Session`   | Server-side session; stores an HMAC of the cookie token, not the token   |
| `Project`   | A website (normalized domain) plus default country / language / device  |
| `Keyword`   | A tracked keyword, with an optional target URL                          |
| `Ranking`   | One position observation. Append-only — history is never overwritten     |
| `RankCheck` | One ranking run: status, totals and progress                            |
| `SerpCache` | Short-lived cache of SERP responses                                     |

`Ranking.position` is nullable: `null` means the domain was not found within the
checked results, and is displayed as **Not Found**.

Indexes exist on `Project.userId`, `Keyword.projectId`, `Ranking.keywordId`,
`Ranking.checkedAt`, `RankCheck.projectId` and `RankCheck.status`, along with
unique constraints on `User.email`, `Project (userId, name)` and
`Keyword (projectId, keyword, country, language, device)`.

---

## Prisma setup

```bash
npx prisma generate            # regenerate the client after a schema change
npm run prisma:migrate         # create + apply a migration in development
npm run prisma:deploy          # apply committed migrations in production
npx prisma studio              # browse the data
```

Migrations live in `prisma/migrations/` and are committed. In Docker, the
entrypoint runs `prisma migrate deploy` before the server starts.

---

## DataForSEO setup

1. Create an account at <https://dataforseo.com> and open **API Access**.
2. Put the API login and password in `.env`:

   ```env
   DATAFORSEO_LOGIN=your-login
   DATAFORSEO_PASSWORD=your-password
   ```

3. Verify the configured location codes against your account:

   ```bash
   npm run dataforseo:locations
   ```

4. Test a single real keyword before running a whole project:

   ```bash
   npm run dataforseo:check -- \
     --keyword "microsoft reseller india" \
     --domain wroffy.com \
     --country IN \
     --device DESKTOP \
     --results 100
   ```

   This prints the top organic results, the detected position, the ranking URL,
   and the results immediately around the match so an off-by-one would be
   obvious. Start with one keyword, then 5, then 10, then larger batches.

### Endpoint used

`POST https://api.dataforseo.com/v3/serp/google/organic/live/advanced`

Authenticated with HTTP Basic. The body is an array holding a single task:

```json
[
  {
    "keyword": "microsoft reseller india",
    "location_code": 2356,
    "language_code": "en",
    "device": "desktop",
    "os": "windows",
    "depth": 100,
    "se_domain": "google.com"
  }
]
```

The live endpoint returns results in one response, so no task-polling workflow
is needed.

### Supported locations

Configured centrally in `src/config/serp.ts`. DataForSEO reuses Google's geo
target IDs (ISO-3166-1 numeric + 2000).

| Country              | `location_code` |
| -------------------- | --------------- |
| India (default)      | 2356            |
| United States        | 2840            |
| United Kingdom       | 2826            |
| Canada               | 2124            |
| Australia            | 2036            |
| United Arab Emirates | 2784            |
| Singapore            | 2702            |

Run `npm run dataforseo:locations` to assert these against the live API rather
than trusting the table. Devices are `desktop` and `mobile`; English is the only
language shipped, and `LANGUAGES` in the same file is where you add more.

### Reliability

- Transient failures (network errors, timeouts, HTTP 408/429/5xx, DataForSEO
  status codes in the 50000 range) are retried up to 3 times with exponential
  backoff.
- Authentication, billing and invalid-request failures are **not** retried, and
  abort the whole run rather than burning credits on every remaining keyword.
- SERP responses are cached for `SERP_CACHE_MINUTES`, keyed by keyword, country,
  language, device and depth.

---

## Testing

```bash
npm test                  # unit tests — no database, no network
npm run test:integration  # end-to-end pipeline against a real database
```

Unit tests (104) cover:

- **Domain matching** — `wroffy.com`, `www.`, `blog.` and `shop.` subdomains
  match; `fakewroffy.com`, `wroffy.com.fake.com` and `example.com/wroffy.com`
  do not.
- **Position** — #1, #10, #50, #100, not found, multiple ranking URLs, and ads
  appearing before the organic block.
- **Change** — `10 → 5 = +5`, `5 → 10 = -5`, `5 → 5 = 0`, `Not Found → 5 = New`,
  `5 → Not Found = Lost`.
- **CSV** — valid and invalid files, empty files, duplicates, a missing keyword
  column, target URLs, special characters, large files, and formula injection.
- **DataForSEO transport** — request shape, Basic auth, what is and is not
  retried, and that credentials never appear in a request body or a thrown error.
- **Logging** — that secrets are redacted from log lines.

Integration tests drive the real pipeline against PostgreSQL with only the
provider's HTTP call stubbed:

```bash
INTEGRATION_DATABASE_URL="postgresql://USER@localhost:5432/ourranktracker" \
  npm run test:integration
```

They run a first check, then a second one, and assert that every position,
change label and history row is correct, that a partial failure is recorded as
`PARTIAL`, and that the CSV export is safe.

---

## Docker

```bash
cp .env.example .env       # set SESSION_SECRET and DataForSEO credentials
docker compose up --build
```

This starts PostgreSQL and the application on <http://localhost:3000>.
Migrations are applied automatically on startup; set `RUN_MIGRATIONS=0` to skip
that.

The image is a multi-stage build producing the Next.js standalone server,
running as a non-root user, with a health check against `/api/health`.

---

## Coolify deployment

Deploying on a VPS with Coolify. You need a domain pointed at the server —
session cookies are `Secure` in production, so sign-in does not work over plain
HTTP.

### 1. Point DNS at the VPS

Add an `A` record for your domain (or subdomain) to the VPS IP address, and wait
for it to resolve:

```bash
dig +short rank.example.com    # should print your VPS IP
```

### 2. Create the PostgreSQL database

In your Coolify project: **+ New → Database → PostgreSQL**. Once it is running,
open it and copy the **internal** connection URL (the one using the service
hostname, not `localhost`). It looks like:

```text
postgresql://postgres:PASSWORD@rn4c8s0ok:5432/postgres
```

Append `?schema=public` when you use it as `DATABASE_URL`.

### 3. Create the application

**+ New → Application → Public/Private Repository**, pointing at this repository
and the `main` branch. Then set:

| Setting          | Value        |
| ---------------- | ------------ |
| Build pack       | `Dockerfile` |
| Dockerfile path  | `Dockerfile` |
| Port             | `3000`       |
| Health check path| `/api/health`|

### 4. Set environment variables

These are **runtime** variables. The Docker build supplies its own placeholders
for `DATABASE_URL` and `SESSION_SECRET`, so the build does not need the real
values and no secret is ever baked into the image.

```env
DATABASE_URL=postgresql://postgres:PASSWORD@HOST:5432/postgres?schema=public
SESSION_SECRET=<paste the output of: openssl rand -base64 48>
DATAFORSEO_LOGIN=<your DataForSEO API login>
DATAFORSEO_PASSWORD=<your DataForSEO API password>
SERP_CONCURRENCY=3
MAX_KEYWORDS_PER_CHECK=500
SERP_RESULTS=100
SERP_CACHE_MINUTES=30
```

Never prefix any of these with `NEXT_PUBLIC_` — that would publish them to the
browser.

### 5. Add the domain and enable HTTPS

Under the application's **Domains**, enter `https://rank.example.com`. Coolify
requests a Let's Encrypt certificate automatically. Confirm the scheme is
`https://`, not `http://`.

### 6. Deploy

Press **Deploy**. On the first run the entrypoint applies the database
migrations before the server starts, so the schema is created for you — watch
the deploy log for:

```text
Applying database migrations...
The following migration(s) have been applied:
  20260902090522_init
 ✓ Ready
```

To apply migrations manually instead, set `RUN_MIGRATIONS=0` and run this in the
container terminal:

```bash
node /opt/prisma-cli/node_modules/prisma/build/index.js migrate deploy
```

### 7. Verify

```bash
curl https://rank.example.com/api/health
# {"status":"ok","database":true,"serpProviderConfigured":true,...}
```

`database: true` means migrations ran and the connection works.
`serpProviderConfigured: true` means the DataForSEO credentials are present.

Then open `https://rank.example.com/register`, create your account, and run one
real keyword check to confirm the provider integration end to end.

Redeploys are automatic on push to `main` if you enable Coolify's webhook.

---

## API routes

All routes require an authenticated session except registration and sign-in.
Every project-scoped route verifies ownership; a project belonging to another
user returns `404`, so existence is not disclosed.

| Method   | Route                                    | Purpose                                     |
| -------- | ---------------------------------------- | ------------------------------------------- |
| `POST`   | `/api/auth/register`                     | Create an account and start a session       |
| `POST`   | `/api/auth/login`                        | Sign in                                     |
| `POST`   | `/api/auth/logout`                       | Sign out                                    |
| `GET`    | `/api/projects`                          | List your projects                          |
| `POST`   | `/api/projects`                          | Create a project                            |
| `GET`    | `/api/projects/[id]`                     | Project with statistics                     |
| `DELETE` | `/api/projects/[id]`                     | Delete a project                            |
| `GET`    | `/api/projects/[id]/keywords`            | Paginated keywords                          |
| `POST`   | `/api/projects/[id]/keywords`            | Add keywords from pasted text               |
| `DELETE` | `/api/projects/[id]/keywords?keywordId=` | Remove a keyword                            |
| `POST`   | `/api/projects/[id]/keywords/import`     | CSV preview (`commit: false`) or import     |
| `POST`   | `/api/projects/[id]/rank-check`          | Start a ranking check (returns `202`)       |
| `GET`    | `/api/projects/[id]/rank-check`          | Recent ranking checks                       |
| `GET`    | `/api/rank-check/[id]`                   | Progress for one check                      |
| `GET`    | `/api/projects/[id]/rankings`            | Paginated ranking table                     |
| `GET`    | `/api/projects/[id]/export`              | CSV export                                  |
| `GET`    | `/api/health`                            | Health probe                                |

There is no `/api/serp/search`, by design.

---

## How ranking detection works

**Organic only.** The response's SERP elements are filtered to `type: "organic"`
*before* positions are assigned, so ads and other paid placements never shift
the numbering. If two ads precede three organic results, those results are
#1, #2 and #3.

**Domain matching by hostname.** A result's URL is parsed and its hostname
compared against the project's normalized domain. A hostname matches when it
equals the domain or ends with `.` + the domain.

| URL                              | Matches `wroffy.com`? |
| -------------------------------- | --------------------- |
| `https://wroffy.com/page`        | yes                   |
| `https://www.wroffy.com/page`    | yes                   |
| `https://blog.wroffy.com/page`   | yes                   |
| `https://shop.wroffy.com/page`   | yes                   |
| `https://fakewroffy.com/page`    | no                    |
| `https://wroffy.com.fake.com/p`  | no                    |
| `https://example.com/wroffy.com` | no                    |

Substring checks such as `url.includes("wroffy.com")` are never used.

**Best position wins.** If the domain appears more than once, the lowest position
is stored along with that result's URL.

**Target URL.** A keyword's target URL is stored and displayed alongside the URL
that actually ranked, so the two can be compared. V1 does not do cannibalization
analysis.

**Change.** The latest ranking is compared with the previous one:
`10 → 5` shows `↑ 5`, `5 → 10` shows `↓ 5`, `5 → 5` shows `—`,
`Not Found → 5` shows `New`, and `5 → Not Found` shows `Lost`.

---

## Security notes

- DataForSEO credentials, `DATABASE_URL` and `SESSION_SECRET` are server-side
  only and live in a module marked `server-only`.
- Passwords are hashed with bcrypt (cost 12).
- The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` in production.
  The database stores an HMAC of the token keyed by `SESSION_SECRET`, so a
  database dump alone cannot be replayed as a valid session.
- Every request body is validated with Zod; all database access goes through
  Prisma.
- Ranking checks are rate limited per user, and sign-in and registration per
  client.
- Errors returned to the browser are generic. Provider, database and runtime
  details are logged server-side with a request id and never sent to the client.
- Logs redact secret-looking keys and scrub known secret values, so credentials
  cannot reach a log line even by accident.
- CSV cells are neutralized against spreadsheet formula injection on import and
  on export.

---

## Seed data

```bash
npm run seed
```

Creates a demo user (`demo@ourranktracker.local` / `demo-password-123`), one
project and 10 keywords with two checks of static ranking history so change
tracking is visible immediately.

The seed **never calls DataForSEO**. The demo user, project and rankings are
flagged `isDemo` and labelled "Demo" in the interface so they cannot be mistaken
for real ranking data. Do not run the seed against a production database.

---

## Troubleshooting

**"Ranking checks are not available because the SERP provider is not configured"**
`DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` are unset. The application refuses
to invent ranking data, so checks are blocked until they are set. Restart the
server after changing them.

**"The SERP provider rejected our credentials"**
Wrong login or password, or the account has no credit. Verify with
`npm run dataforseo:locations`. Use the API login and password from DataForSEO's
API Access page, which are not the same as your dashboard sign-in.

**"Invalid server environment configuration"**
A required variable is missing or malformed. The message names the variables;
compare against `.env.example`. `SESSION_SECRET` must be at least 32 characters.

**Sign-in appears to succeed but immediately bounces back to `/login`**
In production the session cookie is `Secure`, so the site must be served over
HTTPS. Enable TLS, or run with `NODE_ENV=development` locally.

**`prisma migrate deploy` fails on startup**
The database is unreachable or `DATABASE_URL` is wrong. Check the value and that
the database accepts connections from the application container. On Coolify use
the database's **internal** connection URL — the one with the service hostname,
not `localhost` — and remember to append `?schema=public`.

**On Coolify the deploy succeeds but the container keeps restarting**
The entrypoint applies migrations before starting the server and runs under
`set -e`, so a database problem stops the container rather than serving a broken
app. Read the deploy log: the line after `Applying database migrations...` names
the cause. Set `RUN_MIGRATIONS=0` to start the app without migrating while you
investigate.

**Coolify shows the app as unhealthy**
The health check path must be `/api/health` and the port `3000`. Calling that
path returns `{"status":"ok","database":true,...}`; `database: false` means the
server is up but cannot reach PostgreSQL.

**A ranking check finishes as `PARTIAL`**
Some keywords failed after their retries. The check reports how many; run it
again and only the failures cost additional credits — cached SERPs are reused
within `SERP_CACHE_MINUTES`.

**Positions look off by a few places**
Compare against `npm run dataforseo:check` for the same keyword, which prints the
results surrounding the match. Note that this tool reports *organic* position,
which is lower than the visual position on a SERP that shows ads.

---

## Known limitations

- **Rate limiting is per process.** It is held in memory, so running multiple
  replicas gives each its own budget. A shared store would be needed for
  horizontal scaling.
- **Ranking checks run in the application process.** There is no job queue, so a
  restart mid-check leaves that `RankCheck` in `RUNNING`. Rankings already
  written are kept; re-running the check is safe.
- **One check per project at a time.** Starting a second returns the one already
  running.
- **Filtering and sorting happen in memory** over a project's keywords. This is
  comfortable at the V1 target of 500 keywords per project but would need to move
  into SQL well before tens of thousands.
- **English only.** The language configuration is structured for more, but only
  English ships.
- **Seven countries.** Adding one is a line in `src/config/serp.ts`, verified
  with `npm run dataforseo:locations`.
- **Google organic results only.** No maps, news, images or other search engines.
- **No scheduled checks.** Checks are started manually; there is no cron.
- **Ranking history is unbounded.** Every check appends rows. A retention policy
  would be needed for long-running installations.
- **The Docker image has not been built end to end** because the base-image
  registry was unreachable from the environment it was developed in. Everything
  the image does was verified separately, though: `npm ci`, `prisma generate`
  and `npm run build` were run from a clean clone with the same environment the
  builder stage sets, and the runtime layer was assembled exactly as the
  Dockerfile assembles it and booted in isolation — migrations applied to an
  empty database, and register / create project / add keywords / dashboard all
  worked. The first real `docker build` may still surface something these
  checks cannot reach, such as a base-image or apt package problem.
- **The live DataForSEO integration has not been exercised against the real API**
  from this environment, which cannot reach `api.dataforseo.com`. Run
  `npm run dataforseo:check` on a machine with network access as the first step
  after cloning.

---

## License

Private.
