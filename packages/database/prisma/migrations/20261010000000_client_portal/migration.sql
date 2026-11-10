CREATE TYPE "PortalSubmissionStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACCEPTED', 'REJECTED');

CREATE TABLE "PortalInvitation" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "matterId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "invitedEmail" TEXT,
  "partyRole" "MatterPartyRole" NOT NULL,
  "personId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalInvitation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortalSubmission" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "matterId" TEXT NOT NULL,
  "invitationId" TEXT NOT NULL,
  "status" "PortalSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
  "personData" JSONB,
  "submittedAt" TIMESTAMP(3),
  "reviewedAt" TIMESTAMP(3),
  "reviewedById" TEXT,
  "reviewComment" TEXT,
  "acceptedPersonId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PortalSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PortalUpload" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "matterId" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "type" "DocumentType" NOT NULL,
  "originalName" TEXT NOT NULL,
  "objectKey" TEXT NOT NULL,
  "bucket" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" INTEGER NOT NULL,
  "checksum" TEXT NOT NULL,
  "acceptedDocumentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PortalUpload_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalInvitation_tokenHash_key" ON "PortalInvitation"("tokenHash");
CREATE INDEX "PortalInvitation_organizationId_matterId_createdAt_idx" ON "PortalInvitation"("organizationId", "matterId", "createdAt");
CREATE INDEX "PortalInvitation_expiresAt_revokedAt_idx" ON "PortalInvitation"("expiresAt", "revokedAt");
CREATE UNIQUE INDEX "PortalSubmission_invitationId_key" ON "PortalSubmission"("invitationId");
CREATE INDEX "PortalSubmission_organizationId_matterId_status_updatedAt_idx" ON "PortalSubmission"("organizationId", "matterId", "status", "updatedAt");
CREATE UNIQUE INDEX "PortalUpload_acceptedDocumentId_key" ON "PortalUpload"("acceptedDocumentId");
CREATE INDEX "PortalUpload_organizationId_matterId_createdAt_idx" ON "PortalUpload"("organizationId", "matterId", "createdAt");
CREATE INDEX "PortalUpload_submissionId_type_idx" ON "PortalUpload"("submissionId", "type");

ALTER TABLE "PortalInvitation" ADD CONSTRAINT "PortalInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalInvitation" ADD CONSTRAINT "PortalInvitation_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalInvitation" ADD CONSTRAINT "PortalInvitation_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalInvitation" ADD CONSTRAINT "PortalInvitation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortalSubmission" ADD CONSTRAINT "PortalSubmission_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalSubmission" ADD CONSTRAINT "PortalSubmission_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalSubmission" ADD CONSTRAINT "PortalSubmission_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "PortalInvitation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalSubmission" ADD CONSTRAINT "PortalSubmission_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalSubmission" ADD CONSTRAINT "PortalSubmission_acceptedPersonId_fkey" FOREIGN KEY ("acceptedPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "PortalSubmission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortalUpload" ADD CONSTRAINT "PortalUpload_acceptedDocumentId_fkey" FOREIGN KEY ("acceptedDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
