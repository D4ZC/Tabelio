CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'COMPLETED', 'CANCELLED', 'FAILED');

ALTER TABLE "Matter" ADD COLUMN "activatedAt" TIMESTAMP(3);

CREATE TABLE "SignatureRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "signedDocumentId" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "externalReference" TEXT,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT NOT NULL,
    "completedById" TEXT,
    "cancelledById" TEXT,
    "notes" TEXT,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),

    CONSTRAINT "SignatureRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SignatureRequest_signedDocumentId_key" ON "SignatureRequest"("signedDocumentId");
CREATE INDEX "SignatureRequest_organizationId_matterId_requestedAt_idx" ON "SignatureRequest"("organizationId", "matterId", "requestedAt");
CREATE INDEX "SignatureRequest_matterId_status_idx" ON "SignatureRequest"("matterId", "status");

ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_matterId_fkey"
FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_signedDocumentId_fkey"
FOREIGN KEY ("signedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_completedById_fkey"
FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SignatureRequest" ADD CONSTRAINT "SignatureRequest_cancelledById_fkey"
FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
