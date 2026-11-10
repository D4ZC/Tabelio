ALTER TYPE "DocumentType" ADD VALUE 'DRAFT_CONTRACT_PDF';

ALTER TABLE "Document" ADD COLUMN "sourceDocumentId" TEXT;

CREATE INDEX "Document_organizationId_sourceDocumentId_idx"
ON "Document"("organizationId", "sourceDocumentId");

CREATE UNIQUE INDEX "Document_sourceDocumentId_type_key"
ON "Document"("sourceDocumentId", "type");

ALTER TABLE "Document"
ADD CONSTRAINT "Document_sourceDocumentId_fkey"
FOREIGN KEY ("sourceDocumentId") REFERENCES "Document"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
