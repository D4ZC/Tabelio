ALTER TABLE "Document"
  ADD COLUMN "invalidatedAt" TIMESTAMP(3),
  ADD COLUMN "invalidationReason" TEXT,
  ADD COLUMN "invalidatedById" TEXT;

ALTER TABLE "Document"
  ADD CONSTRAINT "Document_invalidatedById_fkey"
  FOREIGN KEY ("invalidatedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Document_organizationId_invalidatedAt_idx"
  ON "Document"("organizationId", "invalidatedAt");
