# Feature Spec — Roles & Access Control

Target repo: `digiemporiaa-dot/ranktracker` (OurRankTracker)

**Build this BEFORE the CRUD spec.** Every ownership check in this app becomes
role-aware. Writing the project-edit and keyword-delete routes first means
writing their ownership logic twice.

---

## What changes

| | Before | After |
| --- | --- | --- |
| Signup | Anyone at `/register` | No public signup |
| Roles | None | `SUPERADMIN`, `EXECUTIVE` |
| Account creation | Self-serve | Superadmin only |
| Project visibility | Own projects | Executive: own only. Superadmin: all |

Executives keep every other permission — create projects, import keywords, run
checks, edit, delete, export. The only thing they cannot do is create accounts
or see another executive's data.

---

## 1. Schema

Add to `prisma/schema.prisma`:

```prisma
enum Role {
  SUPERADMIN
  EXECUTIVE
}

model User {
  // ...existing fields
  role      Role     @default(EXECUTIVE)
  isActive  Boolean  @default(true)
  createdById String?
  createdBy   User?  @relation("UserCreator", fields: [createdById], references: [id], onDelete: SetNull)
  createdUsers User[] @relation("UserCreator")
}
```

`createdById` is for audit — who provisioned this executive. `onDelete: SetNull`
so removing a superadmin doesn't cascade into deleting their executives.

Index `User.role` — the superadmin user list filters on it.

Migration must set the existing account (if any) to `SUPERADMIN` explicitly,
otherwise the default backfills everyone as `EXECUTIVE` and nobody can create
accounts. Write that as a data step in the migration.

---

## 2. Remove public registration

Delete:

- the `/register` page
- `POST /api/auth/register`
- any link to `/register` from the login page

Do **not** keep the route behind an `ALLOW_REGISTRATION` env flag. A disabled
flag is one misconfigured environment variable away from open public signup on a
tool that holds client ranking data. The password-hashing and user-creation
logic stays — it moves into a shared function used by the admin route in
section 4. Re-adding public signup later is a thin route on top of code that
still exists.

`/login` stays exactly as it is. Add a line under the form: accounts are created
by an administrator.

---

## 3. Bootstrap the first superadmin

With registration gone there is no way to create the first account. Add a CLI
script, `scripts/create-superadmin.ts`, wired as `npm run create-superadmin`:

```
npm run create-superadmin -- --email you@example.com
```

Requirements:

- Prompt for the password interactively rather than taking it as an argument —
  arguments land in shell history and process listings
- Enforce a minimum length (12+)
- Refuse to run if a `SUPERADMIN` already exists, unless `--force` is passed
- Idempotent on the email: if that user exists, offer to promote them instead of
  erroring
- Runs against `DATABASE_URL`, so it works in the Coolify container terminal

Do not bootstrap from `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` env vars — that
leaves a live admin password sitting in the Coolify environment permanently.

Document this in the README's Coolify section as the step right after the first
deploy, replacing "open `/register` and create your account".

---

## 4. Admin user management

All routes superadmin-only. An executive hitting any of them gets `404`, not
`403` — the admin surface should not be discoverable.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/admin/users` | List all users |
| `POST` | `/api/admin/users` | Create an executive |
| `PATCH` | `/api/admin/users/[id]` | Rename, activate/deactivate, reset password |
| `DELETE` | `/api/admin/users/[id]` | Delete an executive |

**`POST` body:** `{ email, name, password }`, Zod validated. Role is forced to
`EXECUTIVE` server-side — never read a role off the request body, or an
executive who finds the endpoint promotes themselves. Set `createdById` to the
acting superadmin.

**Deactivation over deletion.** `PATCH { isActive: false }` is the normal way to
remove someone — their projects and history stay intact. Deactivating must also
delete that user's `Session` rows so they are logged out immediately, not at
cookie expiry.

**Deletion** needs an explicit answer for their projects. Require a query param:

- `?onDelete=reassign&toUserId=<id>` — move their projects to another user
- `?onDelete=purge` — cascade-delete projects, keywords, rankings

Refuse a bare `DELETE` with `400` naming both options. Silently destroying a
client's entire ranking history because someone left the company is not an
acceptable default.

**Guards:**

- A superadmin cannot deactivate, delete, or demote themselves
- Refuse to remove the last remaining active `SUPERADMIN`
- Password reset invalidates that user's sessions

**UI:** `/admin/users`, visible in navigation only for superadmins. Table with
email, name, status, project count, created date. Create dialog, deactivate
toggle, reset-password action, delete behind typed confirmation.

---

## 5. Scoping — the important part

Every project-scoped query currently filters by `userId`. Superadmin must bypass
that filter. **Do not scatter `if (role === 'SUPERADMIN')` across the route
handlers** — there are around fifteen of them and the one you miss becomes a
data leak between clients.

Add one helper, e.g. `src/lib/auth/scope.ts`:

```ts
export function projectScope(session: Session) {
  return session.user.role === "SUPERADMIN" ? {} : { userId: session.user.id };
}
```

Then every handler spreads it:

```ts
const project = await prisma.project.findFirst({
  where: { id: params.id, ...projectScope(session) },
});
if (!project) return notFound();
```

The `404`-not-`403` convention is preserved automatically: an executive asking
for someone else's project gets zero rows, same as before.

**Routes that must use it** — audit all of them, none can be skipped:

- `GET`, `POST` `/api/projects`
- `GET`, `PATCH`, `DELETE` `/api/projects/[id]`
- `GET`, `POST`, `DELETE` `/api/projects/[id]/keywords`
- `POST` `/api/projects/[id]/keywords/import`
- `GET`, `POST` `/api/projects/[id]/rank-check`
- `GET` `/api/rank-check/[id]` — reaches the project through `RankCheck.projectId`
- `GET` `/api/projects/[id]/rankings`
- `GET` `/api/projects/[id]/export`

Plus the two new bulk-delete routes from the CRUD spec once those are built.

**`POST /api/projects`** is the exception: a superadmin creating a project still
sets `userId` to themselves. Optionally accept `ownerId` so a superadmin can
provision a project directly for an executive — useful, but make it explicit
rather than implicit.

---

## 6. Session must carry the role

Sessions are already server-side rows, so include the role and active flag in
the session lookup — join to `User` and select `id`, `role`, `isActive`. Never
put the role in the cookie payload.

Session validation must reject the session if `user.isActive` is false, so a
deactivation takes effect on the very next request even if the session rows were
somehow missed.

---

## 7. Superadmin dashboard

A superadmin dropped into the existing project list sees every executive's
projects in one undifferentiated pile. Add, for superadmins only:

- An **Owner** column on the project list
- A filter by executive
- A count summary at the top: total projects, total keywords, active checks

Executives see the list exactly as it is today, with no owner column and no
filter — nothing should hint that other users' data exists.

---

## 8. Tests

- An executive hitting any `/api/admin/*` route gets `404`
- `POST /api/admin/users` with `role: "SUPERADMIN"` in the body still creates an
  `EXECUTIVE`
- Executive A cannot read, edit, or delete Executive B's project, keywords,
  rankings, rank-check, or export — one test per route, no exceptions
- A superadmin can read and edit any project
- Deactivating a user deletes their sessions and blocks the next request
- The last active superadmin cannot be deactivated, deleted, or demoted
- `DELETE /api/admin/users/[id]` without `onDelete` returns `400` and deletes
  nothing
- `onDelete=reassign` moves projects and preserves every ranking row
- `/register` and `POST /api/auth/register` return `404`

---

## Build order

1. Schema + migration (including promoting the existing account)
2. `create-superadmin` script — verify you can still log in before going further
3. Session carries role and `isActive`
4. `projectScope` helper, applied to every route in section 5
5. Remove `/register`
6. Admin user routes and `/admin/users` UI
7. Superadmin owner column and filter
8. Only then: the CRUD spec (project edit, bulk keyword delete, clear-all)

Step 2 before step 5, always. Removing registration before a superadmin exists
locks you out of your own deployment.
