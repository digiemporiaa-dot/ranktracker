# Feature Spec — Project Edit/Delete + Keyword Delete/Clear

Target repo: `digiemporiaa-dot/ranktracker` (OurRankTracker)

---

## Step 0 — Audit before writing anything

Two routes are already documented as existing:

- `DELETE /api/projects/[id]`
- `DELETE /api/projects/[id]/keywords?keywordId=`

Before building, confirm for each:

1. Does the route handler actually exist and work?
2. Is it reachable from the UI, or is the endpoint orphaned?

If the handlers exist and only the UI is missing, sections 2 and 3 below become
UI-only work.

Also read first, before any code:

- `prisma/schema.prisma` — every relation's `onDelete` behaviour
- `src/config/serp.ts` — allowed countries, languages, devices
- One existing mutating route — copy its auth / Zod / error-shape / rate-limit
  pattern exactly rather than inventing a new one

---

## 1. Edit a project (new)

**Route:** `PATCH /api/projects/[id]`

**Editable fields:** `name`, `country`, `language`, `device`

**Deliberately NOT editable: `website` / domain.**

Rationale: every `Ranking` row is a position observation *for that domain*.
Changing the domain silently makes the entire history meaningless — the chart
would show a continuous line across two different websites. If the user needs a
different domain, they create a new project. Show the domain in the edit dialog
as a read-only field with a short tooltip explaining why.

**Validation (Zod):**

- `name` — trimmed, 1–100 chars
- `country`, `language`, `device` — must be members of the lists in
  `src/config/serp.ts`; reject anything else
- All fields optional; reject an empty body

**Handler order:**

1. Session auth
2. Ownership check — a project owned by another user returns `404`, never `403`
3. Zod parse
4. Update

**Unique constraint:** `Project (userId, name)` exists. Catch Prisma `P2002` and
return `409` with a message like "You already have a project with that name."
Do not let the raw Prisma error reach the client.

**Important semantic to surface in the UI:** changing country / language /
device only changes the *defaults applied to newly added keywords*. Existing
`Keyword` rows keep their own country / language / device values, because
`(projectId, keyword, country, language, device)` is the keyword's unique key.
Put one line of helper text under those fields saying so, otherwise users will
expect their existing keywords to re-check under the new country.

**UI:** edit dialog opened from the project page header, pre-filled with current
values. Save button disabled until something actually changes.

---

## 2. Delete a project

Route already documented. Verify and harden.

**Cascade:** `Keyword`, `Ranking`, `RankCheck` (and `SerpCache` if it holds a
project FK) must have `onDelete: Cascade` in `prisma/schema.prisma`. If they
don't, the delete throws a foreign-key error. Either add the cascade with a
migration, or delete children explicitly inside a transaction. Prefer the
cascade — it is one migration and removes the ordering problem permanently.

**Running check guard:** if a `RankCheck` for this project has status `RUNNING`,
return `409` with "A ranking check is running for this project. Wait for it to
finish or cancel it." Deleting mid-check leaves the in-process worker writing
rows against a project that no longer exists.

**UI:** destructive confirm dialog. The confirm button stays disabled until the
user types the project's exact name. Dialog must state plainly that all
keywords and the full ranking history are deleted permanently. On success,
redirect to the project list with a toast.

---

## 3. Delete a single keyword

Route already documented. Verify and harden.

**History warning:** deleting a keyword cascades its `Ranking` rows, so its
position history is gone permanently. The confirm dialog must say this — it is
not obvious to the user, who may think they are just removing it from future
checks.

If you would rather preserve history, the alternative is a soft delete
(`Keyword.deletedAt`) with every query filtering on it. That is a larger change
touching the dashboard stats, the ranking table, the export and the check
runner. Recommendation for V1: keep the hard delete and warn clearly.

**Guard:** `409` if a check is `RUNNING` for the project.

**UI:** trash icon on each row of the keywords / rankings table, with a compact
confirm dialog.

---

## 4. Bulk delete selected keywords (new)

**Route:** `POST /api/projects/[id]/keywords/bulk-delete`

**Body:** `{ keywordIds: string[] }` — Zod, min 1, max 500 (match
`MAX_KEYWORDS_PER_CHECK`)

**Critical:** scope the delete by project, do not trust the ids:

```ts
await prisma.keyword.deleteMany({
  where: { id: { in: keywordIds }, projectId },
});
```

Passing ids from another user's project must silently delete nothing, not error
in a way that reveals those ids exist.

**Response:** `{ deleted: n }`. If `n` is less than the ids sent, the UI shows
"Deleted n of m" rather than claiming full success.

**Guard:** `409` if a check is `RUNNING`.

**UI:** checkbox column on the keywords table, select-all in the header (selects
the current page only — say so), and a "Delete selected (n)" button that appears
once anything is selected. One confirm dialog for the batch.

---

## 5. Clear all keywords (new)

**Route:** `DELETE /api/projects/[id]/keywords/all`

**Body:** `{ confirm: string }` — must exactly equal the project's name.
Mismatch returns `400`. This is the most destructive non-account action in the
app; a plain button is not enough friction.

**Behaviour:** `deleteMany({ where: { projectId } })`, rankings cascade. Also
delete this project's `RankCheck` rows in the same transaction — they would
otherwise reference a project with zero keywords and render as empty history.

**Guard:** `409` if a check is `RUNNING`.

**UI:** put this in a "Danger zone" block at the bottom of a project settings
view, visually separated from the normal keyword controls. Never place it next
to "Add keywords".

---

## Cross-cutting requirements

Apply to every route above:

- Session auth required
- Ownership verified before anything else; non-owner gets `404`
- Zod validation on body and route params
- Rate limited the same way existing mutating routes are
- Client gets a generic error message; provider / database / runtime detail goes
  to the server log with the request id, per the existing convention
- Optimistic UI update with rollback on failure, matching how existing mutations
  are written in this codebase
- Every destructive action behind a confirm dialog; project delete and clear-all
  additionally require typed confirmation

---

## Tests to add under `tests/`

- `PATCH` rejects an unknown country / language / device
- `PATCH` on another user's project returns `404`
- `PATCH` to a duplicate project name returns `409`, not a 500
- Deleting a project removes its keywords, rankings and rank checks
- Every destructive route returns `409` while a `RankCheck` is `RUNNING`
- Bulk delete ignores ids belonging to a different project
- Clear-all with a wrong confirm string deletes nothing and returns `400`
