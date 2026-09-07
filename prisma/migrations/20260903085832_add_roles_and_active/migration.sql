-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPERADMIN', 'EXECUTIVE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "role" "Role" NOT NULL DEFAULT 'EXECUTIVE';

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_createdById_idx" ON "User"("createdById");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Promote the pre-existing account to SUPERADMIN.
--
-- Without this, the DEFAULT above backfills every existing row as EXECUTIVE and
-- nobody can provision accounts.
--
-- The promotion is applied only when there is exactly one non-demo account, so
-- an ambiguous database is never guessed at. With zero accounts, or with
-- several, this statement changes nothing and `npm run create-superadmin` is
-- the way in. The seeded demo user is excluded either way.
UPDATE "User"
SET "role" = 'SUPERADMIN'
WHERE "isDemo" = false
  AND (SELECT COUNT(*) FROM "User" WHERE "isDemo" = false) = 1;
