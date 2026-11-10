CREATE TYPE "RequirementCompletionMode" AS ENUM ('AUTO', 'MANUAL');

CREATE TABLE "RequirementDefinition" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "matterKind" "MatterKind" NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "blocking" BOOLEAN NOT NULL DEFAULT true,
  "appliesToRole" TEXT,
  "completionMode" "RequirementCompletionMode" NOT NULL DEFAULT 'MANUAL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RequirementDefinition_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "ChecklistItem"
  ADD COLUMN "completionMode" "RequirementCompletionMode" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0;

UPDATE "ChecklistItem" checklist
SET "sortOrder" = catalog."sortOrder"
FROM "Matter" matter
, (VALUES
  ('LEASE'::"MatterKind", 'PROPERTY', 10),
  ('LEASE'::"MatterKind", 'PARTY_LANDLORD', 20),
  ('LEASE'::"MatterKind", 'PARTY_TENANT', 30),
  ('LEASE'::"MatterKind", 'PARTY_GUARANTOR', 40),
  ('LEASE'::"MatterKind", 'LEASE_TERMS', 50),
  ('LEASE'::"MatterKind", 'DOC_LANDLORD_ID', 60),
  ('LEASE'::"MatterKind", 'DOC_TENANT_ID', 70),
  ('LEASE'::"MatterKind", 'DOC_GUARANTOR_ID', 80),
  ('LEASE'::"MatterKind", 'DOC_PROPERTY_TITLE', 90),
  ('LEASE'::"MatterKind", 'GUARANTEE_PROPERTY', 100),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'LINKED_LEASE', 10),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'MEDIATION_DATA', 20),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PROPERTY', 30),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_LANDLORD', 40),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_TENANT', 50),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_GUARANTOR', 60),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_LANDLORD_ID', 70),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_TENANT_ID', 80),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_GUARANTOR_ID', 90),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_PROPERTY_TITLE', 100),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'GUARANTEE_PROPERTY', 110),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_LEASE_ANNEX', 120)
) AS catalog("matterKind", "code", "sortOrder")
WHERE matter."id" = checklist."matterId"
  AND catalog."matterKind" = matter."kind"
  AND catalog."code" = checklist."code";

CREATE UNIQUE INDEX "RequirementDefinition_organizationId_matterKind_code_key"
  ON "RequirementDefinition"("organizationId", "matterKind", "code");
CREATE INDEX "RequirementDefinition_organizationId_matterKind_active_sortOrder_idx"
  ON "RequirementDefinition"("organizationId", "matterKind", "active", "sortOrder");

ALTER TABLE "RequirementDefinition"
  ADD CONSTRAINT "RequirementDefinition_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "RequirementDefinition" (
  "id", "organizationId", "matterKind", "code", "label", "blocking",
  "appliesToRole", "completionMode", "active", "sortOrder", "createdAt", "updatedAt"
)
SELECT
  'req_' || md5(o."id" || ':' || definitions."matterKind"::text || ':' || definitions."code"),
  o."id",
  definitions."matterKind",
  definitions."code",
  definitions."label",
  definitions."blocking",
  definitions."appliesToRole",
  'AUTO'::"RequirementCompletionMode",
  true,
  definitions."sortOrder",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "Organization" o
CROSS JOIN (VALUES
  ('LEASE'::"MatterKind", 'PROPERTY', 'Inmueble capturado', true, NULL, 10),
  ('LEASE'::"MatterKind", 'PARTY_LANDLORD', 'Arrendador/a capturado/a', true, 'LANDLORD', 20),
  ('LEASE'::"MatterKind", 'PARTY_TENANT', 'Arrendatario/a capturado/a', true, 'TENANT', 30),
  ('LEASE'::"MatterKind", 'PARTY_GUARANTOR', 'Obligado solidario capturado', true, 'GUARANTOR', 40),
  ('LEASE'::"MatterKind", 'LEASE_TERMS', 'Renta, depósito, vigencia y forma de pago', true, NULL, 50),
  ('LEASE'::"MatterKind", 'DOC_LANDLORD_ID', 'Identificación del arrendador', true, 'LANDLORD', 60),
  ('LEASE'::"MatterKind", 'DOC_TENANT_ID', 'Identificación del arrendatario', true, 'TENANT', 70),
  ('LEASE'::"MatterKind", 'DOC_GUARANTOR_ID', 'Identificación del obligado solidario', true, 'GUARANTOR', 80),
  ('LEASE'::"MatterKind", 'DOC_PROPERTY_TITLE', 'Documento que acredita propiedad', true, NULL, 90),
  ('LEASE'::"MatterKind", 'GUARANTEE_PROPERTY', 'Inmueble y documento ofrecidos en garantía', false, 'GUARANTOR', 100),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'LINKED_LEASE', 'Contrato de arrendamiento relacionado', true, NULL, 10),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'MEDIATION_DATA', 'Número, expediente, fecha y facilitador', true, NULL, 20),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PROPERTY', 'Inmueble capturado', true, NULL, 30),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_LANDLORD', 'Arrendador/a capturado/a', true, 'LANDLORD', 40),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_TENANT', 'Arrendatario/a capturado/a', true, 'TENANT', 50),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'PARTY_GUARANTOR', 'Obligado solidario capturado', true, 'GUARANTOR', 60),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_LANDLORD_ID', 'Identificación del arrendador', true, 'LANDLORD', 70),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_TENANT_ID', 'Identificación del arrendatario', true, 'TENANT', 80),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_GUARANTOR_ID', 'Identificación del obligado solidario', true, 'GUARANTOR', 90),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_PROPERTY_TITLE', 'Documento que acredita propiedad', true, NULL, 100),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'GUARANTEE_PROPERTY', 'Inmueble y documento ofrecidos en garantía', false, 'GUARANTOR', 110),
  ('MEDIATION_AGREEMENT'::"MatterKind", 'DOC_LEASE_ANNEX', 'Contrato agregado como Anexo 1', true, NULL, 120)
) AS definitions("matterKind", "code", "label", "blocking", "appliesToRole", "sortOrder")
ON CONFLICT ("organizationId", "matterKind", "code") DO NOTHING;
