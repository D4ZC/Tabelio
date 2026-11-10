ALTER TABLE "PilotProgram"
ADD COLUMN "current" BOOLEAN NOT NULL DEFAULT true;

DROP INDEX "PilotProgram_organizationId_key";

CREATE UNIQUE INDEX "PilotProgram_one_current_per_organization_key"
ON "PilotProgram"("organizationId")
WHERE "current" = true;

CREATE INDEX "PilotProgram_organizationId_current_createdAt_idx"
ON "PilotProgram"("organizationId", "current", "createdAt");
