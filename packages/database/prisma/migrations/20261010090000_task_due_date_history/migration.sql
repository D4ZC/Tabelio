CREATE TABLE "TaskDueDateChange" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "previousDueAt" TIMESTAMP(3),
    "newDueAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDueDateChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TaskDueDateChange_organizationId_createdAt_idx"
  ON "TaskDueDateChange"("organizationId", "createdAt");
CREATE INDEX "TaskDueDateChange_taskId_createdAt_idx"
  ON "TaskDueDateChange"("taskId", "createdAt");

ALTER TABLE "TaskDueDateChange" ADD CONSTRAINT "TaskDueDateChange_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDueDateChange" ADD CONSTRAINT "TaskDueDateChange_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDueDateChange" ADD CONSTRAINT "TaskDueDateChange_changedById_fkey"
FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
