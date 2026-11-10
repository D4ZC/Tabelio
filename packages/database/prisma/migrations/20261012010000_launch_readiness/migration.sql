CREATE TYPE "LaunchProgramStatus" AS ENUM ('DRAFT', 'REVIEW', 'GO', 'NO_GO');
CREATE TYPE "LaunchTargetEnvironment" AS ENUM ('LOCAL', 'STAGING', 'PRODUCTION');
CREATE TYPE "LaunchUatCategory" AS ENUM ('FUNCTIONAL', 'LEGAL', 'OPERATIONS', 'SECURITY', 'RESILIENCE');
CREATE TYPE "LaunchUatStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'PASSED', 'FAILED');
CREATE TYPE "LaunchIntegrationKind" AS ENUM ('OCR', 'SIGNATURE', 'EMAIL', 'CALENDAR', 'PASSWORD_RECOVERY');
CREATE TYPE "LaunchIntegrationStatus" AS ENUM ('PENDING', 'SIMULATED', 'VERIFIED', 'BLOCKED');
CREATE TYPE "LaunchComplianceStatus" AS ENUM ('PENDING', 'COMPLETE');

CREATE TABLE "LaunchProgram" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "LaunchProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "current" BOOLEAN NOT NULL DEFAULT true,
    "targetEnvironment" "LaunchTargetEnvironment" NOT NULL DEFAULT 'LOCAL',
    "scope" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decisionRationale" TEXT,
    "decisionSnapshot" JSONB,
    "snapshotChecksum" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchProgram_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaunchUatCase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "matterId" TEXT,
    "assignedMembershipId" TEXT,
    "title" TEXT NOT NULL,
    "category" "LaunchUatCategory" NOT NULL,
    "expectedResult" TEXT NOT NULL,
    "status" "LaunchUatStatus" NOT NULL DEFAULT 'PENDING',
    "actualResult" TEXT,
    "evidence" TEXT,
    "createdById" TEXT NOT NULL,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchUatCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaunchIntegrationCheck" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "kind" "LaunchIntegrationKind" NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "LaunchIntegrationStatus" NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "testedById" TEXT,
    "testedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchIntegrationCheck_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaunchComplianceControl" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "status" "LaunchComplianceStatus" NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LaunchComplianceControl_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LaunchMetricSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "programId" TEXT NOT NULL,
    "sourcePilotProgramId" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "gates" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "capturedById" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LaunchMetricSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LaunchProgram_one_current_per_organization_key"
ON "LaunchProgram"("organizationId")
WHERE "current" = true;
CREATE INDEX "LaunchProgram_organizationId_status_idx" ON "LaunchProgram"("organizationId", "status");
CREATE INDEX "LaunchProgram_organizationId_current_createdAt_idx" ON "LaunchProgram"("organizationId", "current", "createdAt");
CREATE UNIQUE INDEX "LaunchUatCase_programId_title_key" ON "LaunchUatCase"("programId", "title");
CREATE INDEX "LaunchUatCase_organizationId_status_category_idx" ON "LaunchUatCase"("organizationId", "status", "category");
CREATE INDEX "LaunchUatCase_programId_createdAt_idx" ON "LaunchUatCase"("programId", "createdAt");
CREATE UNIQUE INDEX "LaunchIntegrationCheck_programId_kind_key" ON "LaunchIntegrationCheck"("programId", "kind");
CREATE INDEX "LaunchIntegrationCheck_organizationId_status_idx" ON "LaunchIntegrationCheck"("organizationId", "status");
CREATE UNIQUE INDEX "LaunchComplianceControl_programId_code_key" ON "LaunchComplianceControl"("programId", "code");
CREATE INDEX "LaunchComplianceControl_organizationId_status_idx" ON "LaunchComplianceControl"("organizationId", "status");
CREATE INDEX "LaunchMetricSnapshot_organizationId_capturedAt_idx" ON "LaunchMetricSnapshot"("organizationId", "capturedAt");
CREATE INDEX "LaunchMetricSnapshot_programId_capturedAt_idx" ON "LaunchMetricSnapshot"("programId", "capturedAt");

ALTER TABLE "LaunchProgram" ADD CONSTRAINT "LaunchProgram_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchProgram" ADD CONSTRAINT "LaunchProgram_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaunchProgram" ADD CONSTRAINT "LaunchProgram_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LaunchProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_assignedMembershipId_fkey" FOREIGN KEY ("assignedMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaunchUatCase" ADD CONSTRAINT "LaunchUatCase_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchIntegrationCheck" ADD CONSTRAINT "LaunchIntegrationCheck_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchIntegrationCheck" ADD CONSTRAINT "LaunchIntegrationCheck_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LaunchProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchIntegrationCheck" ADD CONSTRAINT "LaunchIntegrationCheck_testedById_fkey" FOREIGN KEY ("testedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchComplianceControl" ADD CONSTRAINT "LaunchComplianceControl_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchComplianceControl" ADD CONSTRAINT "LaunchComplianceControl_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LaunchProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchComplianceControl" ADD CONSTRAINT "LaunchComplianceControl_completedById_fkey" FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LaunchMetricSnapshot" ADD CONSTRAINT "LaunchMetricSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchMetricSnapshot" ADD CONSTRAINT "LaunchMetricSnapshot_programId_fkey" FOREIGN KEY ("programId") REFERENCES "LaunchProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LaunchMetricSnapshot" ADD CONSTRAINT "LaunchMetricSnapshot_sourcePilotProgramId_fkey" FOREIGN KEY ("sourcePilotProgramId") REFERENCES "PilotProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LaunchMetricSnapshot" ADD CONSTRAINT "LaunchMetricSnapshot_capturedById_fkey" FOREIGN KEY ("capturedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
