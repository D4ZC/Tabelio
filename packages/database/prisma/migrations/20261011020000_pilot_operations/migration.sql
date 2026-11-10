CREATE TYPE "PilotProgramStatus" AS ENUM ('DRAFT', 'READY', 'ACTIVE', 'PAUSED', 'COMPLETED');
CREATE TYPE "PilotParticipantStatus" AS ENUM ('ACTIVE', 'REMOVED');
CREATE TYPE "PilotValidationResult" AS ENUM ('PENDING', 'MATCH', 'MISMATCH');
CREATE TYPE "PilotIssueSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "PilotIssueStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');
CREATE TYPE "PilotImportStatus" AS ENUM ('READY', 'BLOCKED', 'COMMITTED', 'CANCELLED');

CREATE TABLE "PilotProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "PilotProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 0,
    "targetCases" INTEGER NOT NULL DEFAULT 10,
    "startsAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PilotProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PilotParticipant" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "status" "PilotParticipantStatus" NOT NULL DEFAULT 'ACTIVE',
    "trainingEvidence" TEXT,
    "trainedAt" TIMESTAMP(3),
    "trainedById" TEXT,
    "addedById" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    CONSTRAINT "PilotParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PilotValidation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "legacyReference" TEXT,
    "result" "PilotValidationResult" NOT NULL DEFAULT 'PENDING',
    "notes" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PilotValidation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PilotIssue" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "matterId" TEXT,
    "category" TEXT NOT NULL,
    "severity" "PilotIssueSeverity" NOT NULL,
    "status" "PilotIssueStatus" NOT NULL DEFAULT 'OPEN',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolution" TEXT,
    "assignedMembershipId" TEXT,
    "reportedById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PilotIssue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PilotImportBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourceName" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "status" "PilotImportStatus" NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "validRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "payload" JSONB NOT NULL,
    "validation" JSONB NOT NULL,
    "importedEntityIds" JSONB,
    "createdById" TEXT NOT NULL,
    "committedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),
    CONSTRAINT "PilotImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PilotProgram_organizationId_key" ON "PilotProgram"("organizationId");
CREATE INDEX "PilotProgram_organizationId_status_idx" ON "PilotProgram"("organizationId", "status");
CREATE UNIQUE INDEX "PilotParticipant_programId_membershipId_key" ON "PilotParticipant"("programId", "membershipId");
CREATE INDEX "PilotParticipant_organizationId_status_idx" ON "PilotParticipant"("organizationId", "status");
CREATE UNIQUE INDEX "PilotValidation_programId_matterId_key" ON "PilotValidation"("programId", "matterId");
CREATE INDEX "PilotValidation_organizationId_result_idx" ON "PilotValidation"("organizationId", "result");
CREATE INDEX "PilotIssue_organizationId_status_severity_idx" ON "PilotIssue"("organizationId", "status", "severity");
CREATE INDEX "PilotIssue_programId_reportedAt_idx" ON "PilotIssue"("programId", "reportedAt");
CREATE UNIQUE INDEX "PilotImportBatch_organizationId_checksum_key" ON "PilotImportBatch"("organizationId", "checksum");
CREATE INDEX "PilotImportBatch_organizationId_status_createdAt_idx" ON "PilotImportBatch"("organizationId", "status", "createdAt");

ALTER TABLE "PilotProgram" ADD CONSTRAINT "PilotProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PilotProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_trainedById_fkey" FOREIGN KEY ("trainedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotParticipant" ADD CONSTRAINT "PilotParticipant_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotValidation" ADD CONSTRAINT "PilotValidation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotValidation" ADD CONSTRAINT "PilotValidation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PilotProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotValidation" ADD CONSTRAINT "PilotValidation_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotValidation" ADD CONSTRAINT "PilotValidation_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PilotProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotIssue" ADD CONSTRAINT "PilotIssue_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PilotImportBatch" ADD CONSTRAINT "PilotImportBatch_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotImportBatch" ADD CONSTRAINT "PilotImportBatch_programId_fkey" FOREIGN KEY ("programId") REFERENCES "PilotProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PilotImportBatch" ADD CONSTRAINT "PilotImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PilotImportBatch" ADD CONSTRAINT "PilotImportBatch_committedById_fkey" FOREIGN KEY ("committedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
