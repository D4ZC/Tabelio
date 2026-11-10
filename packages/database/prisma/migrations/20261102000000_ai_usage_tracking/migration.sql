-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiOperation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT,
    "parentId" TEXT,
    "kind" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "documentId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROCESSING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiUsageAttempt" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "providerResponseId" TEXT,
    "providerRequestId" TEXT,
    "httpStatus" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "confirmedCost" DECIMAL(24,12),
    "estimatedCost" DECIMAL(24,12),
    "currency" TEXT,
    "costSource" TEXT,
    "state" TEXT NOT NULL DEFAULT 'STARTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "AiUsageAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiBudgetSnapshot" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "providerConfigHash" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "currency" TEXT,
    "limit" DECIMAL(24,12),
    "spent" DECIMAL(24,12),
    "remaining" DECIMAL(24,12),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiBudgetSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiConversation_organizationId_userId_createdAt_idx" ON "AiConversation"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiOperation_organizationId_userId_createdAt_idx" ON "AiOperation"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiOperation_conversationId_createdAt_idx" ON "AiOperation"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageAttempt_organizationId_userId_createdAt_idx" ON "AiUsageAttempt"("organizationId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageAttempt_operationId_createdAt_idx" ON "AiUsageAttempt"("operationId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsageAttempt_state_createdAt_idx" ON "AiUsageAttempt"("state", "createdAt");

-- CreateIndex
CREATE INDEX "AiBudgetSnapshot_organizationId_userId_providerConfigHash_idx" ON "AiBudgetSnapshot"("organizationId", "userId", "providerConfigHash");

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiConversation" ADD CONSTRAINT "AiConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AiConversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiOperation" ADD CONSTRAINT "AiOperation_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "AiOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageAttempt" ADD CONSTRAINT "AiUsageAttempt_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageAttempt" ADD CONSTRAINT "AiUsageAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageAttempt" ADD CONSTRAINT "AiUsageAttempt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "AiOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudgetSnapshot" ADD CONSTRAINT "AiBudgetSnapshot_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiBudgetSnapshot" ADD CONSTRAINT "AiBudgetSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

