CREATE TABLE "TaskDependency" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnTaskId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TaskDependency_not_self" CHECK ("taskId" <> "dependsOnTaskId")
);

CREATE UNIQUE INDEX "TaskDependency_taskId_dependsOnTaskId_key"
  ON "TaskDependency"("taskId", "dependsOnTaskId");
CREATE INDEX "TaskDependency_organizationId_createdAt_idx"
  ON "TaskDependency"("organizationId", "createdAt");
CREATE INDEX "TaskDependency_dependsOnTaskId_idx"
  ON "TaskDependency"("dependsOnTaskId");

ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_dependsOnTaskId_fkey"
FOREIGN KEY ("dependsOnTaskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
