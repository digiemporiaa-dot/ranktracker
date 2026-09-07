-- Promote the instance owner to SUPERADMIN, by email.
--
-- The previous migration backfills every existing account as EXECUTIVE and then
-- promotes one only when the database is unambiguous (exactly one non-demo
-- account). That guard is deliberately cautious: on a database with several
-- accounts it promotes nobody, which would leave a deployment with no
-- administrator and no way into /admin/users.
--
-- This migration removes that uncertainty by naming the owner outright. It is
-- a data-only migration: no table, column or index changes.
--
-- What it does to existing data:
--   * the account whose email is the owner's, and which is not the seeded demo
--     user, has its role set to SUPERADMIN
--   * every other row is untouched — no account is demoted, deactivated,
--     renamed or deleted
--   * if no such account exists yet, nothing happens and the migration still
--     succeeds; `npm run create-superadmin` is then the way in
--   * running it twice changes nothing the second time
--
-- Emails are stored lowercased by the application, but this compares
-- case-insensitively so a row created before that normalization still matches.
UPDATE "User"
SET "role" = 'SUPERADMIN'
WHERE lower("email") = 'digiemporiaa@gmail.com'
  AND "isDemo" = false;
