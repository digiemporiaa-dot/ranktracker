-- Tell "we could not read the SERP" apart from "the site does not rank".
--
-- Until now a Ranking row carried only a nullable position, so a provider
-- outage and a genuine absence from the results looked identical once stored:
-- both were position = NULL, and the dashboard read both as "Not Found". A
-- DataForSEO task that answers 40102 "No Search Results." with items = null
-- would therefore be written into the history as a lost ranking.
--
-- This migration adds the status that distinguishes them, plus the provider
-- diagnostics behind a failed attempt.
--
-- Nothing here deletes or rewrites a position. Every existing row is a row
-- that was produced from a SERP the application actually read, so the backfill
-- classifies it from what it already says:
--   position IS NOT NULL -> RANKED
--   position IS NULL     -> NOT_RANKED
-- which is exactly how those rows were being interpreted before. No history
-- changes meaning, and no existing row becomes SERP_UNAVAILABLE retroactively —
-- we have no evidence either way for checks that ran before this column.

-- ---------------------------------------------------------------------------
-- 1. The status enum.
-- ---------------------------------------------------------------------------
CREATE TYPE "SerpStatus" AS ENUM ('RANKED', 'NOT_RANKED', 'SERP_UNAVAILABLE', 'API_ERROR');

-- ---------------------------------------------------------------------------
-- 2. Ranking: status + the provider's own account of a failed attempt.
-- ---------------------------------------------------------------------------
ALTER TABLE "Ranking"
  ADD COLUMN "status" "SerpStatus",
  ADD COLUMN "apiStatusCode" INTEGER,
  ADD COLUMN "apiStatusMessage" TEXT,
  ADD COLUMN "attempts" INTEGER;

UPDATE "Ranking"
SET "status" = CASE
      WHEN "position" IS NOT NULL THEN 'RANKED'::"SerpStatus"
      ELSE 'NOT_RANKED'::"SerpStatus"
    END;

-- Every row is classified by the statement above, so a NULL here would mean
-- the backfill did not run and the migration should stop rather than leave the
-- history half-labelled.
ALTER TABLE "Ranking"
  ALTER COLUMN "status" SET NOT NULL,
  ALTER COLUMN "status" SET DEFAULT 'NOT_RANKED';

-- The dashboard asks for the most recent *measured* row per keyword, skipping
-- any failed attempts recorded on top of it.
CREATE INDEX "Ranking_keywordId_status_checkedAt_idx"
  ON "Ranking"("keywordId", "status", "checkedAt");

-- ---------------------------------------------------------------------------
-- 3. Keyword: when a SERP was last actually read.
-- ---------------------------------------------------------------------------
--
-- Backfilled from the newest measured ranking the keyword already has, which
-- is a fact the database can prove. Keywords that have never been checked
-- stay NULL.
ALTER TABLE "Keyword" ADD COLUMN "lastSuccessfulCheckAt" TIMESTAMP(3);

UPDATE "Keyword" k
SET "lastSuccessfulCheckAt" = latest."checkedAt"
FROM (
  SELECT DISTINCT ON ("keywordId") "keywordId", "checkedAt"
  FROM "Ranking"
  WHERE "status" IN ('RANKED', 'NOT_RANKED')
  ORDER BY "keywordId", "checkedAt" DESC
) latest
WHERE latest."keywordId" = k."id";
