CREATE TYPE "ReminderType" AS ENUM ('RENEWAL');
CREATE TYPE "ReminderChannel" AS ENUM ('IN_APP', 'EMAIL', 'CALENDAR');
CREATE TYPE "ReminderStatus" AS ENUM ('SCHEDULED', 'DUE', 'ACKNOWLEDGED', 'CANCELLED');

CREATE TABLE "Reminder" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "type" "ReminderType" NOT NULL,
    "channel" "ReminderChannel" NOT NULL DEFAULT 'IN_APP',
    "thresholdDays" INTEGER NOT NULL,
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'SCHEDULED',
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reminder_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Reminder_dedupeKey_key" ON "Reminder"("dedupeKey");
CREATE INDEX "Reminder_organizationId_status_scheduledFor_idx" ON "Reminder"("organizationId", "status", "scheduledFor");
CREATE INDEX "Reminder_matterId_type_status_idx" ON "Reminder"("matterId", "type", "status");
CREATE INDEX "Reminder_recipientUserId_status_scheduledFor_idx" ON "Reminder"("recipientUserId", "status", "scheduledFor");

ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_matterId_fkey"
FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_recipientUserId_fkey"
FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Reminder" ADD CONSTRAINT "Reminder_acknowledgedById_fkey"
FOREIGN KEY ("acknowledgedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
