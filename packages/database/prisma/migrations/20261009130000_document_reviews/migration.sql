CREATE TYPE "DocumentReviewDecision" AS ENUM ('CHANGES_REQUESTED', 'LEGAL_APPROVED', 'FINAL_APPROVED');

CREATE TABLE "DocumentReview" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reviewerUserId" TEXT NOT NULL,
    "decision" "DocumentReviewDecision" NOT NULL,
    "comment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocumentReview_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DocumentReview_organizationId_matterId_createdAt_idx"
ON "DocumentReview"("organizationId", "matterId", "createdAt");

CREATE INDEX "DocumentReview_documentId_createdAt_idx"
ON "DocumentReview"("documentId", "createdAt");

ALTER TABLE "DocumentReview"
ADD CONSTRAINT "DocumentReview_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentReview"
ADD CONSTRAINT "DocumentReview_matterId_fkey"
FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentReview"
ADD CONSTRAINT "DocumentReview_documentId_fkey"
FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "DocumentReview"
ADD CONSTRAINT "DocumentReview_reviewerUserId_fkey"
FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
