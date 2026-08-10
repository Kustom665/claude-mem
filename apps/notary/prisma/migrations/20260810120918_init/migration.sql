-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "businessName" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "commissionNumber" TEXT,
    "commissionState" TEXT,
    "commissionCounty" TEXT,
    "commissionIssuedOn" DATETIME,
    "commissionExpiresOn" DATETIME,
    "sealDescription" TEXT,
    "isSigningAgent" BOOLEAN NOT NULL DEFAULT false,
    "backgroundCheckExpiresOn" DATETIME,
    "eoPolicyNumber" TEXT,
    "eoCoverageCents" INTEGER,
    "eoExpiresOn" DATETIME,
    "bondNumber" TEXT,
    "bondAmountCents" INTEGER,
    "bondExpiresOn" DATETIME,
    "timezone" TEXT NOT NULL DEFAULT 'America/Los_Angeles',
    "mileageRateCents" INTEGER NOT NULL DEFAULT 70,
    "journalStartNumber" INTEGER NOT NULL DEFAULT 1,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
    "invoiceTermsDays" INTEGER NOT NULL DEFAULT 30,
    "plan" TEXT NOT NULL DEFAULT 'trial',
    "subscriptionStatus" TEXT NOT NULL DEFAULT 'trialing',
    "trialEndsOn" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'SIGNING_SERVICE',
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "defaultFeeCents" INTEGER,
    "paymentTermsDays" INTEGER NOT NULL DEFAULT 30,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Client_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Signing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientId" TEXT,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'LOAN_SIGNING',
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "scheduledAt" DATETIME NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "completedAt" DATETIME,
    "signerName" TEXT,
    "signerPhone" TEXT,
    "signerEmail" TEXT,
    "coSignerName" TEXT,
    "locationName" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "loanNumber" TEXT,
    "escrowNumber" TEXT,
    "propertyAddress" TEXT,
    "documentCount" INTEGER,
    "signingFeeCents" INTEGER NOT NULL DEFAULT 0,
    "travelFeeCents" INTEGER NOT NULL DEFAULT 0,
    "printFeeCents" INTEGER NOT NULL DEFAULT 0,
    "additionalFeeCents" INTEGER NOT NULL DEFAULT 0,
    "mileageMiles" REAL NOT NULL DEFAULT 0,
    "scanBacksRequired" BOOLEAN NOT NULL DEFAULT false,
    "shippingCarrier" TEXT,
    "trackingNumber" TEXT,
    "docsReturnedAt" DATETIME,
    "notes" TEXT,
    "invoiceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Signing_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Signing_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Signing_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sequenceNumber" INTEGER NOT NULL,
    "performedAt" DATETIME NOT NULL,
    "actType" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentDate" DATETIME,
    "documentDescription" TEXT,
    "numberOfSignatures" INTEGER NOT NULL DEFAULT 1,
    "signerName" TEXT NOT NULL,
    "signerAddressLine1" TEXT,
    "signerCity" TEXT,
    "signerState" TEXT,
    "signerPostalCode" TEXT,
    "signerPhone" TEXT,
    "signerEmail" TEXT,
    "identityMethod" TEXT NOT NULL,
    "idType" TEXT,
    "idIssuer" TEXT,
    "idNumberLast4" TEXT,
    "idIssuedOn" DATETIME,
    "idExpiresOn" DATETIME,
    "credibleWitnessName" TEXT,
    "credibleWitnessAddress" TEXT,
    "secondCredibleWitnessName" TEXT,
    "feeChargedCents" INTEGER NOT NULL DEFAULT 0,
    "travelFeeCents" INTEGER NOT NULL DEFAULT 0,
    "notarizedRemotely" BOOLEAN NOT NULL DEFAULT false,
    "ronPlatform" TEXT,
    "thumbprintTaken" BOOLEAN NOT NULL DEFAULT false,
    "witnessNames" TEXT,
    "locationCity" TEXT,
    "locationState" TEXT,
    "notes" TEXT,
    "signingId" TEXT,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,
    "sealedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendsEntryId" TEXT,
    "amendmentReason" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "JournalEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_signingId_fkey" FOREIGN KEY ("signingId") REFERENCES "Signing" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JournalEntry_amendsEntryId_fkey" FOREIGN KEY ("amendsEntryId") REFERENCES "JournalEntry" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

-- CreateTable
CREATE TABLE "MileageEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "signingId" TEXT,
    "date" DATETIME NOT NULL,
    "miles" REAL NOT NULL,
    "ratePerMileCents" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "fromAddress" TEXT,
    "toAddress" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MileageEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MileageEntry_signingId_fkey" FOREIGN KEY ("signingId") REFERENCES "Signing" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "issueDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" DATETIME NOT NULL,
    "sentAt" DATETIME,
    "paidAt" DATETIME,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "amountPaidCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "terms" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" REAL NOT NULL DEFAULT 1,
    "unitAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FeeScheduleItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "actType" TEXT,
    "amountCents" INTEGER NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'PER_SIGNATURE',
    "stateMaxCents" INTEGER,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FeeScheduleItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CertificateTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "actType" TEXT NOT NULL,
    "state" TEXT,
    "body" TEXT NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CertificateTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
CREATE INDEX "Client_userId_isActive_idx" ON "Client"("userId", "isActive");

-- CreateIndex
CREATE INDEX "Client_userId_name_idx" ON "Client"("userId", "name");

-- CreateIndex
CREATE INDEX "Signing_userId_scheduledAt_idx" ON "Signing"("userId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Signing_userId_status_idx" ON "Signing"("userId", "status");

-- CreateIndex
CREATE INDEX "Signing_clientId_idx" ON "Signing"("clientId");

-- CreateIndex
CREATE INDEX "Signing_invoiceId_idx" ON "Signing"("invoiceId");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_performedAt_idx" ON "JournalEntry"("userId", "performedAt");

-- CreateIndex
CREATE INDEX "JournalEntry_userId_signerName_idx" ON "JournalEntry"("userId", "signerName");

-- CreateIndex
CREATE INDEX "JournalEntry_signingId_idx" ON "JournalEntry"("signingId");

-- CreateIndex
CREATE INDEX "JournalEntry_amendsEntryId_idx" ON "JournalEntry"("amendsEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_userId_sequenceNumber_key" ON "JournalEntry"("userId", "sequenceNumber");

-- CreateIndex
CREATE INDEX "MileageEntry_userId_date_idx" ON "MileageEntry"("userId", "date");

-- CreateIndex
CREATE INDEX "MileageEntry_signingId_idx" ON "MileageEntry"("signingId");

-- CreateIndex
CREATE INDEX "Invoice_userId_status_idx" ON "Invoice"("userId", "status");

-- CreateIndex
CREATE INDEX "Invoice_clientId_idx" ON "Invoice"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_userId_number_key" ON "Invoice"("userId", "number");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "FeeScheduleItem_userId_isActive_idx" ON "FeeScheduleItem"("userId", "isActive");

-- CreateIndex
CREATE INDEX "CertificateTemplate_userId_idx" ON "CertificateTemplate"("userId");

-- CreateIndex
CREATE INDEX "CertificateTemplate_actType_idx" ON "CertificateTemplate"("actType");
