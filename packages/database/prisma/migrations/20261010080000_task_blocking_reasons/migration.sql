ALTER TABLE "Task"
  ADD COLUMN "blockedReason" TEXT,
  ADD COLUMN "blockedAt" TIMESTAMP(3),
  ADD COLUMN "blockedById" TEXT;

CREATE INDEX "Task_organizationId_status_blockedAt_idx"
  ON "Task"("organizationId", "status", "blockedAt");

ALTER TABLE "Task" ADD CONSTRAINT "Task_blockedById_fkey"
FOREIGN KEY ("blockedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
