ALTER TABLE "Document"
  ADD COLUMN "issuedAt" TIMESTAMP(3),
  ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "Document_organizationId_expiresAt_idx"
  ON "Document"("organizationId", "expiresAt");
