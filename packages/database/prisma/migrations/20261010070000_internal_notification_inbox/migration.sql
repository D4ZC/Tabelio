ALTER TYPE "ReminderType" ADD VALUE 'MATTER_ASSIGNED';
ALTER TYPE "ReminderType" ADD VALUE 'TASK_ASSIGNED';
ALTER TYPE "ReminderType" ADD VALUE 'TASK_ESCALATED';

ALTER TABLE "Reminder"
  ALTER COLUMN "thresholdDays" DROP NOT NULL,
  ADD COLUMN "taskId" TEXT;

CREATE INDEX "Reminder_taskId_type_status_idx"
  ON "Reminder"("taskId", "type", "status");

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;
