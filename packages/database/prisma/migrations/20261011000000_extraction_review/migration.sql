CREATE TYPE "ExtractionReviewDecision" AS ENUM ('CONFIRMED', 'CORRECTED', 'REJECTED');

CREATE TABLE "DocumentExtractionRun" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ExtractionStatus" NOT NULL,
    "rawData" JSONB,
    "fieldCandidates" JSONB,
    "message" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "DocumentExtractionRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "DocumentExtractionReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "extractionRunId" TEXT NOT NULL,
    "decision" "ExtractionReviewDecision" NOT NULL,
    "confirmedData" JSONB,
    "comment" TEXT NOT NULL,
    "reviewedById" TEXT NOT NULL,
    "reviewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentExtractionReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentExtractionRun_organizationId_status_requestedAt_idx"
  ON "DocumentExtractionRun"("organizationId", "status", "requestedAt");
CREATE INDEX "DocumentExtractionRun_documentId_requestedAt_idx"
  ON "DocumentExtractionRun"("documentId", "requestedAt");
CREATE UNIQUE INDEX "DocumentExtractionReview_extractionRunId_key"
  ON "DocumentExtractionReview"("extractionRunId");
CREATE INDEX "DocumentExtractionReview_organizationId_reviewedAt_idx"
  ON "DocumentExtractionReview"("organizationId", "reviewedAt");

ALTER TABLE "DocumentExtractionRun" ADD CONSTRAINT "DocumentExtractionRun_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentExtractionRun" ADD CONSTRAINT "DocumentExtractionRun_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentExtractionRun" ADD CONSTRAINT "DocumentExtractionRun_requestedById_fkey"
FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DocumentExtractionReview" ADD CONSTRAINT "DocumentExtractionReview_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentExtractionReview" ADD CONSTRAINT "DocumentExtractionReview_extractionRunId_fkey"
FOREIGN KEY ("extractionRunId") REFERENCES "DocumentExtractionRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DocumentExtractionReview" ADD CONSTRAINT "DocumentExtractionReview_reviewedById_fkey"
FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
