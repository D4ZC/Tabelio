-- CreateTable
CREATE TABLE "LibraryDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "collectionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "originalPath" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "documentTypeLabel" TEXT NOT NULL,
    "legalFamily" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "usage" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "packageLabel" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "review" JSONB NOT NULL,
    "duplicateOf" TEXT,
    "textEquivalentTo" TEXT,
    "importedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LibraryDocumentLink" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "libraryDocumentId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LibraryDocumentLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryDocument_organizationId_documentType_source_idx" ON "LibraryDocument"("organizationId", "documentType", "source");

-- CreateIndex
CREATE INDEX "LibraryDocument_organizationId_legalFamily_variant_idx" ON "LibraryDocument"("organizationId", "legalFamily", "variant");

-- CreateIndex
CREATE INDEX "LibraryDocument_organizationId_collectionId_packageId_idx" ON "LibraryDocument"("organizationId", "collectionId", "packageId");

-- CreateIndex
CREATE INDEX "LibraryDocument_organizationId_sha256_idx" ON "LibraryDocument"("organizationId", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryDocument_organizationId_collectionId_externalId_key" ON "LibraryDocument"("organizationId", "collectionId", "externalId");

-- CreateIndex
CREATE INDEX "LibraryDocumentLink_organizationId_documentId_idx" ON "LibraryDocumentLink"("organizationId", "documentId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryDocumentLink_libraryDocumentId_documentId_key" ON "LibraryDocumentLink"("libraryDocumentId", "documentId");

-- AddForeignKey
ALTER TABLE "LibraryDocument" ADD CONSTRAINT "LibraryDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDocument" ADD CONSTRAINT "LibraryDocument_importedById_fkey" FOREIGN KEY ("importedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDocumentLink" ADD CONSTRAINT "LibraryDocumentLink_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDocumentLink" ADD CONSTRAINT "LibraryDocumentLink_libraryDocumentId_fkey" FOREIGN KEY ("libraryDocumentId") REFERENCES "LibraryDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LibraryDocumentLink" ADD CONSTRAINT "LibraryDocumentLink_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
