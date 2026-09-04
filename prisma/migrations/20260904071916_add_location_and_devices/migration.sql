-- Location targeting (country + optional city) and per-device rank tracking.
--
-- Nothing here deletes a row. Every new column is backfilled from what the
-- database already says, and each backfill is followed by SET NOT NULL, so an
-- unexpected value aborts the migration instead of silently writing a wrong
-- location or device onto real ranking history.
--
-- What it does to existing data, in order:
--   1. Project/Keyword gain city (NULL = whole country), locationCode and
--      googleDomain. locationCode is derived from the country each row already
--      has. googleDomain is set to google.com, which is the domain those rows
--      were actually checked against — the per-country domains only apply to
--      keywords created from now on.
--   2. Project.device (one device) becomes Project.devices (a list). Every
--      project keeps exactly the device it had.
--   3. Ranking gains device, locationCode and googleDomain, copied from the
--      keyword the ranking belongs to. That is the configuration those checks
--      genuinely ran with: a keyword's device and location are part of its
--      identity and have never been editable, so no row is guessed at and no
--      desktop history is relabelled as mobile.
--   4. The keyword uniqueness constraint moves from
--      (projectId, keyword, country, language, device) to
--      (projectId, keyword, locationCode, language, device). locationCode is a
--      1:1 replacement for country on existing rows, so no row can collide
--      that did not collide before.

-- ---------------------------------------------------------------------------
-- 1. Project: new location columns, left nullable until they are backfilled.
-- ---------------------------------------------------------------------------
ALTER TABLE "Project"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "locationCode" INTEGER,
  ADD COLUMN "googleDomain" TEXT,
  ADD COLUMN "devices" "Device"[] DEFAULT ARRAY['DESKTOP']::"Device"[];

UPDATE "Project"
SET "locationCode" = CASE "country"
      WHEN 'IN' THEN 2356
      WHEN 'US' THEN 2840
      WHEN 'GB' THEN 2826
      WHEN 'CA' THEN 2124
      WHEN 'AU' THEN 2036
      WHEN 'AE' THEN 2784
      WHEN 'SG' THEN 2702
    END,
    -- The domain these projects' keywords have been checked against so far.
    "googleDomain" = 'google.com',
    -- One device becomes a one-element list. MOBILE projects stay MOBILE.
    "devices" = ARRAY["device"];

-- A country outside the supported set would leave locationCode NULL and stop
-- the migration here, rather than quietly filing it under India.
ALTER TABLE "Project"
  ALTER COLUMN "locationCode" SET NOT NULL,
  ALTER COLUMN "locationCode" SET DEFAULT 2356,
  ALTER COLUMN "googleDomain" SET NOT NULL,
  ALTER COLUMN "googleDomain" SET DEFAULT 'google.com';

-- ---------------------------------------------------------------------------
-- 2. Keyword: the same location columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "Keyword"
  ADD COLUMN "city" TEXT,
  ADD COLUMN "locationCode" INTEGER,
  ADD COLUMN "googleDomain" TEXT;

UPDATE "Keyword"
SET "locationCode" = CASE "country"
      WHEN 'IN' THEN 2356
      WHEN 'US' THEN 2840
      WHEN 'GB' THEN 2826
      WHEN 'CA' THEN 2124
      WHEN 'AU' THEN 2036
      WHEN 'AE' THEN 2784
      WHEN 'SG' THEN 2702
    END,
    "googleDomain" = 'google.com';

ALTER TABLE "Keyword"
  ALTER COLUMN "locationCode" SET NOT NULL,
  ALTER COLUMN "locationCode" SET DEFAULT 2356,
  ALTER COLUMN "googleDomain" SET NOT NULL,
  ALTER COLUMN "googleDomain" SET DEFAULT 'google.com';

-- ---------------------------------------------------------------------------
-- 3. Ranking: record the device and location each position came from.
-- ---------------------------------------------------------------------------
ALTER TABLE "Ranking"
  ADD COLUMN "device" "Device",
  ADD COLUMN "locationCode" INTEGER,
  ADD COLUMN "googleDomain" TEXT;

UPDATE "Ranking" r
SET "device" = k."device",
    "locationCode" = k."locationCode",
    "googleDomain" = k."googleDomain"
FROM "Keyword" k
WHERE k."id" = r."keywordId";

-- A ranking whose keyword has gone would be left NULL and stop the migration.
-- There should be none: Ranking.keywordId cascades on delete.
ALTER TABLE "Ranking"
  ALTER COLUMN "device" SET NOT NULL,
  ALTER COLUMN "locationCode" SET NOT NULL,
  ALTER COLUMN "googleDomain" SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. Drop the single-device column now that every project has its list.
-- ---------------------------------------------------------------------------
ALTER TABLE "Project" DROP COLUMN "device";

-- ---------------------------------------------------------------------------
-- 5. Move keyword identity from country to locationCode.
-- ---------------------------------------------------------------------------
DROP INDEX "Keyword_projectId_keyword_country_language_device_key";

CREATE UNIQUE INDEX "Keyword_projectId_keyword_locationCode_language_device_key"
  ON "Keyword"("projectId", "keyword", "locationCode", "language", "device");

CREATE INDEX "Keyword_projectId_locationCode_device_idx"
  ON "Keyword"("projectId", "locationCode", "device");

CREATE INDEX "Ranking_keywordId_device_checkedAt_idx"
  ON "Ranking"("keywordId", "device", "checkedAt");
