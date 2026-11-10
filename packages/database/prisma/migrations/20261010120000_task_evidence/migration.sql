ALTER TABLE "Task"
ADD COLUMN "requiresEvidence" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "TaskDocumentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "linkedById" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDocumentLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TaskDocumentLink_taskId_documentId_key"
  ON "TaskDocumentLink"("taskId", "documentId");
CREATE INDEX "TaskDocumentLink_organizationId_linkedAt_idx"
  ON "TaskDocumentLink"("organizationId", "linkedAt");
CREATE INDEX "TaskDocumentLink_documentId_idx"
  ON "TaskDocumentLink"("documentId");

ALTER TABLE "TaskDocumentLink" ADD CONSTRAINT "TaskDocumentLink_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDocumentLink" ADD CONSTRAINT "TaskDocumentLink_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDocumentLink" ADD CONSTRAINT "TaskDocumentLink_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TaskDocumentLink" ADD CONSTRAINT "TaskDocumentLink_linkedById_fkey"
FOREIGN KEY ("linkedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
