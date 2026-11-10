CREATE TYPE "ClauseVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED');

CREATE TABLE "Clause" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "matterKind" "MatterKind" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Clause_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClauseVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ClauseVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    CONSTRAINT "ClauseVersion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "MatterClauseSelection" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "clauseId" TEXT NOT NULL,
    "clauseVersionId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "selectedById" TEXT NOT NULL,
    "selectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatterClauseSelection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentClauseSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "clauseVersionId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "clauseVersionNumber" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DocumentClauseSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Clause_organizationId_code_key" ON "Clause"("organizationId", "code");
CREATE INDEX "Clause_organizationId_matterKind_active_idx" ON "Clause"("organizationId", "matterKind", "active");
CREATE UNIQUE INDEX "ClauseVersion_clauseId_version_key" ON "ClauseVersion"("clauseId", "version");
CREATE INDEX "ClauseVersion_organizationId_status_createdAt_idx" ON "ClauseVersion"("organizationId", "status", "createdAt");
CREATE UNIQUE INDEX "MatterClauseSelection_matterId_clauseId_key" ON "MatterClauseSelection"("matterId", "clauseId");
CREATE UNIQUE INDEX "MatterClauseSelection_matterId_sortOrder_key" ON "MatterClauseSelection"("matterId", "sortOrder");
CREATE INDEX "MatterClauseSelection_organizationId_matterId_idx" ON "MatterClauseSelection"("organizationId", "matterId");
CREATE UNIQUE INDEX "DocumentClauseSnapshot_documentId_clauseVersionId_key" ON "DocumentClauseSnapshot"("documentId", "clauseVersionId");
CREATE INDEX "DocumentClauseSnapshot_organizationId_documentId_sortOrder_idx" ON "DocumentClauseSnapshot"("organizationId", "documentId", "sortOrder");

ALTER TABLE "Clause" ADD CONSTRAINT "Clause_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Clause" ADD CONSTRAINT "Clause_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClauseVersion" ADD CONSTRAINT "ClauseVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClauseVersion" ADD CONSTRAINT "ClauseVersion_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "Clause"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClauseVersion" ADD CONSTRAINT "ClauseVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClauseVersion" ADD CONSTRAINT "ClauseVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MatterClauseSelection" ADD CONSTRAINT "MatterClauseSelection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatterClauseSelection" ADD CONSTRAINT "MatterClauseSelection_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MatterClauseSelection" ADD CONSTRAINT "MatterClauseSelection_clauseId_fkey" FOREIGN KEY ("clauseId") REFERENCES "Clause"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatterClauseSelection" ADD CONSTRAINT "MatterClauseSelection_clauseVersionId_fkey" FOREIGN KEY ("clauseVersionId") REFERENCES "ClauseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MatterClauseSelection" ADD CONSTRAINT "MatterClauseSelection_selectedById_fkey" FOREIGN KEY ("selectedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentClauseSnapshot" ADD CONSTRAINT "DocumentClauseSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentClauseSnapshot" ADD CONSTRAINT "DocumentClauseSnapshot_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentClauseSnapshot" ADD CONSTRAINT "DocumentClauseSnapshot_clauseVersionId_fkey" FOREIGN KEY ("clauseVersionId") REFERENCES "ClauseVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
