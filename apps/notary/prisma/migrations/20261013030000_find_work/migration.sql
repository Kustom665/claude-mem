-- AlterTable
ALTER TABLE "User" ADD COLUMN     "acceptingRequests" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "publicBio" TEXT,
ADD COLUMN     "publicHeadline" TEXT,
ADD COLUMN     "publicSlug" TEXT,
ADD COLUMN     "readinessChecklist" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "requestMinNoticeHours" INTEGER NOT NULL DEFAULT 24,
ADD COLUMN     "serviceArea" TEXT,
ADD COLUMN     "servicesOffered" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "showFeesPublicly" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showPhonePublicly" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SourceApplication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceKey" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTHER',
    "status" TEXT NOT NULL DEFAULT 'RESEARCHING',
    "website" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "appliedOn" TIMESTAMP(3),
    "approvedOn" TIMESTAMP(3),
    "lastContactOn" TIMESTAMP(3),
    "nextFollowUpOn" TIMESTAMP(3),
    "notes" TEXT,
    "clientId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceApplication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "requesterName" TEXT NOT NULL,
    "requesterPhone" TEXT,
    "requesterEmail" TEXT,
    "preferredContact" TEXT NOT NULL DEFAULT 'ANY',
    "service" TEXT NOT NULL,
    "documentSummary" TEXT,
    "signerCount" INTEGER NOT NULL DEFAULT 1,
    "preferredDate" TIMESTAMP(3),
    "preferredWindow" TEXT NOT NULL DEFAULT 'FLEXIBLE',
    "addressLine1" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "message" TEXT,
    "signingId" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceApplication_userId_status_idx" ON "SourceApplication"("userId", "status");

-- CreateIndex
CREATE INDEX "SourceApplication_userId_nextFollowUpOn_idx" ON "SourceApplication"("userId", "nextFollowUpOn");

-- CreateIndex
CREATE UNIQUE INDEX "SourceApplication_userId_sourceKey_key" ON "SourceApplication"("userId", "sourceKey");

-- CreateIndex
CREATE INDEX "WorkRequest_userId_status_createdAt_idx" ON "WorkRequest"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkRequest_ipHash_createdAt_idx" ON "WorkRequest"("ipHash", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "User_publicSlug_key" ON "User"("publicSlug");

-- AddForeignKey
ALTER TABLE "SourceApplication" ADD CONSTRAINT "SourceApplication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkRequest" ADD CONSTRAINT "WorkRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
