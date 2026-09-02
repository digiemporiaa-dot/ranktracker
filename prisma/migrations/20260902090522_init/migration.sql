-- CreateEnum
CREATE TYPE "Device" AS ENUM ('DESKTOP', 'MOBILE');

-- CreateEnum
CREATE TYPE "RankCheckStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "language" TEXT NOT NULL DEFAULT 'en',
    "device" "Device" NOT NULL DEFAULT 'DESKTOP',
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "keyword" TEXT NOT NULL,
    "targetUrl" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "language" TEXT NOT NULL DEFAULT 'en',
    "device" "Device" NOT NULL DEFAULT 'DESKTOP',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ranking" (
    "id" TEXT NOT NULL,
    "keywordId" TEXT NOT NULL,
    "position" INTEGER,
    "rankingUrl" TEXT,
    "resultsChecked" INTEGER,
    "rankCheckId" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ranking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankCheck" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "status" "RankCheckStatus" NOT NULL DEFAULT 'PENDING',
    "totalKeywords" INTEGER NOT NULL DEFAULT 0,
    "completedKeywords" INTEGER NOT NULL DEFAULT 0,
    "failedKeywords" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SerpCache" (
    "id" TEXT NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SerpCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_email_idx" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Project_userId_idx" ON "Project"("userId");

-- CreateIndex
CREATE INDEX "Project_userId_createdAt_idx" ON "Project"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Project_userId_name_key" ON "Project"("userId", "name");

-- CreateIndex
CREATE INDEX "Keyword_projectId_idx" ON "Keyword"("projectId");

-- CreateIndex
CREATE INDEX "Keyword_projectId_active_idx" ON "Keyword"("projectId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_projectId_keyword_country_language_device_key" ON "Keyword"("projectId", "keyword", "country", "language", "device");

-- CreateIndex
CREATE INDEX "Ranking_keywordId_idx" ON "Ranking"("keywordId");

-- CreateIndex
CREATE INDEX "Ranking_checkedAt_idx" ON "Ranking"("checkedAt");

-- CreateIndex
CREATE INDEX "Ranking_keywordId_checkedAt_idx" ON "Ranking"("keywordId", "checkedAt");

-- CreateIndex
CREATE INDEX "Ranking_rankCheckId_idx" ON "Ranking"("rankCheckId");

-- CreateIndex
CREATE INDEX "RankCheck_projectId_idx" ON "RankCheck"("projectId");

-- CreateIndex
CREATE INDEX "RankCheck_status_idx" ON "RankCheck"("status");

-- CreateIndex
CREATE INDEX "RankCheck_projectId_createdAt_idx" ON "RankCheck"("projectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SerpCache_cacheKey_key" ON "SerpCache"("cacheKey");

-- CreateIndex
CREATE INDEX "SerpCache_expiresAt_idx" ON "SerpCache"("expiresAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ranking" ADD CONSTRAINT "Ranking_rankCheckId_fkey" FOREIGN KEY ("rankCheckId") REFERENCES "RankCheck"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankCheck" ADD CONSTRAINT "RankCheck_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
