-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MembershipRole" AS ENUM ('ADMIN', 'LAWYER', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "PersonType" AS ENUM ('INDIVIDUAL', 'COMPANY');

-- CreateEnum
CREATE TYPE "MatterKind" AS ENUM ('LEASE', 'MEDIATION_AGREEMENT');

-- CreateEnum
CREATE TYPE "MatterStatus" AS ENUM ('DRAFT', 'INTEGRATION', 'PENDING_CLIENT', 'VALIDATION', 'READY_TO_DRAFT', 'DRAFTING', 'REVIEW', 'APPROVAL', 'SIGNATURE', 'ACTIVE', 'RENEWAL_DUE', 'TERMINATION', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MatterPartyRole" AS ENUM ('LANDLORD', 'TENANT', 'GUARANTOR', 'REQUESTING_PARTY', 'COMPLEMENTARY_PARTY', 'FACILITATOR', 'REPRESENTATIVE', 'OTHER');

-- CreateEnum
CREATE TYPE "ChecklistStatus" AS ENUM ('PENDING', 'COMPLETE', 'WAIVED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('LANDLORD_ID', 'TENANT_ID', 'GUARANTOR_ID', 'TAX_ID', 'PROOF_OF_ADDRESS', 'PROPERTY_TITLE', 'GUARANTEE_PROPERTY_TITLE', 'LEASE_ANNEX', 'DRAFT_CONTRACT', 'SIGNED_CONTRACT', 'OTHER');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('NOT_REQUESTED', 'MANUAL_REVIEW', 'PROCESSING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "MembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" "PersonType" NOT NULL DEFAULT 'INDIVIDUAL',
    "legalName" TEXT NOT NULL,
    "givenName" TEXT,
    "familyName" TEXT,
    "gender" TEXT,
    "nationality" TEXT,
    "birthPlaceCity" TEXT,
    "birthPlaceState" TEXT,
    "birthPlaceCountry" TEXT,
    "birthDate" TIMESTAMP(3),
    "maritalStatus" TEXT,
    "occupation" TEXT,
    "taxId" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT DEFAULT 'México',
    "identificationType" TEXT,
    "identificationNumber" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Property" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "useType" TEXT NOT NULL DEFAULT 'Casa habitación',
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "neighborhood" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'México',
    "cadastralReference" TEXT,
    "registryReference" TEXT,
    "ownershipEvidence" TEXT,
    "ownerPersonId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Property_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Matter" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "MatterKind" NOT NULL,
    "status" "MatterStatus" NOT NULL DEFAULT 'DRAFT',
    "propertyId" TEXT,
    "guaranteePropertyId" TEXT,
    "linkedMatterId" TEXT,
    "responsibleMembershipId" TEXT,
    "createdById" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Matter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatterParty" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "MatterPartyRole" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatterParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaseTerms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "rentAmount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'MXN',
    "depositAmount" DECIMAL(14,2),
    "prepaidRentAmount" DECIMAL(14,2),
    "totalInitialPayment" DECIMAL(14,2),
    "dueDay" INTEGER NOT NULL DEFAULT 5,
    "paymentMethod" TEXT,
    "maintenanceIncluded" BOOLEAN NOT NULL DEFAULT true,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "durationMonths" INTEGER NOT NULL DEFAULT 12,
    "noticeDays" INTEGER NOT NULL DEFAULT 30,
    "lateFeePercent" DECIMAL(5,2) NOT NULL DEFAULT 5,
    "holdoverSurchargePercent" DECIMAL(5,2) NOT NULL DEFAULT 50,
    "earlyTerminationPenaltyMonths" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "LeaseTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediationTerms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "agreementNumber" TEXT,
    "caseFileNumber" TEXT,
    "hearingAt" TIMESTAMP(3),
    "centerName" TEXT,
    "centerAccreditationNumber" TEXT,
    "facilitatorName" TEXT,
    "facilitatorCertification" TEXT,
    "certifiedCopies" INTEGER NOT NULL DEFAULT 3,

    CONSTRAINT "MediationTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChecklistItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT true,
    "appliesToRole" TEXT,
    "status" "ChecklistStatus" NOT NULL DEFAULT 'PENDING',
    "completedAt" TIMESTAMP(3),
    "waivedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT,
    "personId" TEXT,
    "propertyId" TEXT,
    "type" "DocumentType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "checksum" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "extractionStatus" "ExtractionStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
    "extractedData" JSONB,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "matterId" TEXT,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_userId_idx" ON "Membership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_organizationId_userId_key" ON "Membership"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "Person_organizationId_legalName_idx" ON "Person"("organizationId", "legalName");

-- CreateIndex
CREATE INDEX "Person_organizationId_taxId_idx" ON "Person"("organizationId", "taxId");

-- CreateIndex
CREATE INDEX "Property_organizationId_displayName_idx" ON "Property"("organizationId", "displayName");

-- CreateIndex
CREATE INDEX "Matter_organizationId_status_idx" ON "Matter"("organizationId", "status");

-- CreateIndex
CREATE INDEX "Matter_organizationId_kind_idx" ON "Matter"("organizationId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Matter_organizationId_reference_key" ON "Matter"("organizationId", "reference");

-- CreateIndex
CREATE INDEX "MatterParty_organizationId_role_idx" ON "MatterParty"("organizationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "MatterParty_matterId_personId_role_key" ON "MatterParty"("matterId", "personId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "LeaseTerms_matterId_key" ON "LeaseTerms"("matterId");

-- CreateIndex
CREATE INDEX "LeaseTerms_organizationId_idx" ON "LeaseTerms"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MediationTerms_matterId_key" ON "MediationTerms"("matterId");

-- CreateIndex
CREATE INDEX "MediationTerms_organizationId_idx" ON "MediationTerms"("organizationId");

-- CreateIndex
CREATE INDEX "ChecklistItem_organizationId_status_idx" ON "ChecklistItem"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ChecklistItem_matterId_code_key" ON "ChecklistItem"("matterId", "code");

-- CreateIndex
CREATE INDEX "Document_organizationId_matterId_idx" ON "Document"("organizationId", "matterId");

-- CreateIndex
CREATE INDEX "Document_organizationId_type_idx" ON "Document"("organizationId", "type");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_createdAt_idx" ON "AuditEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_organizationId_matterId_createdAt_idx" ON "AuditEvent"("organizationId", "matterId", "createdAt");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Property" ADD CONSTRAINT "Property_ownerPersonId_fkey" FOREIGN KEY ("ownerPersonId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_guaranteePropertyId_fkey" FOREIGN KEY ("guaranteePropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_linkedMatterId_fkey" FOREIGN KEY ("linkedMatterId") REFERENCES "Matter"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_responsibleMembershipId_fkey" FOREIGN KEY ("responsibleMembershipId") REFERENCES "Membership"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Matter" ADD CONSTRAINT "Matter_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterParty" ADD CONSTRAINT "MatterParty_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterParty" ADD CONSTRAINT "MatterParty_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatterParty" ADD CONSTRAINT "MatterParty_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseTerms" ADD CONSTRAINT "LeaseTerms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaseTerms" ADD CONSTRAINT "LeaseTerms_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediationTerms" ADD CONSTRAINT "MediationTerms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediationTerms" ADD CONSTRAINT "MediationTerms_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChecklistItem" ADD CONSTRAINT "ChecklistItem_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_matterId_fkey" FOREIGN KEY ("matterId") REFERENCES "Matter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
