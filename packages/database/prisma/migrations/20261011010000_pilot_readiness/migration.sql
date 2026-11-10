CREATE TYPE "PilotCheckpointStatus" AS ENUM ('PENDING', 'COMPLETE');

CREATE TABLE "PilotCheckpoint" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "status" "PilotCheckpointStatus" NOT NULL DEFAULT 'PENDING',
    "evidence" TEXT,
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotCheckpoint_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PilotCheckpoint_organizationId_code_key"
ON "PilotCheckpoint"("organizationId", "code");

CREATE INDEX "PilotCheckpoint_organizationId_status_idx"
ON "PilotCheckpoint"("organizationId", "status");

ALTER TABLE "PilotCheckpoint"
ADD CONSTRAINT "PilotCheckpoint_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PilotCheckpoint"
ADD CONSTRAINT "PilotCheckpoint_completedById_fkey"
FOREIGN KEY ("completedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
