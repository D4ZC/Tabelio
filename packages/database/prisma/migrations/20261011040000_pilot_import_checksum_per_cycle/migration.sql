DROP INDEX "PilotImportBatch_organizationId_checksum_key";

CREATE UNIQUE INDEX "PilotImportBatch_programId_checksum_key"
ON "PilotImportBatch"("programId", "checksum");
