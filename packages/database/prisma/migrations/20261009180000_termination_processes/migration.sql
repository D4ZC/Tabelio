ALTER TYPE "DocumentType" ADD VALUE 'TERMINATION_EVIDENCE';

CREATE TYPE "TerminationStatus" AS ENUM ('OPEN', 'COMPLETED', 'CANCELLED');

CREATE TABLE "TerminationProcess" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "status" "TerminationStatus" NOT NULL DEFAULT 'OPEN',
    "previousMatterStatus" "MatterStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3),
    "startedById" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelledById" TEXT,
    "cancellationReason" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closureReason" TEXT,
    "evidenceDocumentId" TEXT,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "TerminationProcess_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TerminationProcess_evidenceDocumentId_key" ON "TerminationProcess"("evidenceDocumentId");
CREATE INDEX "TerminationProcess_organizationId_matterId_startedAt_idx" ON "TerminationProcess"("organizationId", "matterId", "startedAt");
CREATE INDEX "TerminationProcess_matterId_status_idx" ON "TerminationProcess"("matterId", "status");

ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_matterId_fkey"
FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_startedById_fkey"
FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_closedById_fkey"
FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TerminationProcess" ADD CONSTRAINT "TerminationProcess_evidenceDocumentId_fkey"
FOREIGN KEY ("evidenceDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
