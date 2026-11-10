import {
  MatterKind,
  MembershipRole,
  PrismaClient,
  RequirementCompletionMode,
} from '@prisma/client';
import { hash } from 'bcryptjs';

const prisma = new PrismaClient();

const leaseRequirements = [
  { code: 'PROPERTY', label: 'Inmueble capturado', blocking: true },
  { code: 'PARTY_LANDLORD', label: 'Arrendador/a capturado/a', blocking: true, appliesToRole: 'LANDLORD' },
  { code: 'PARTY_TENANT', label: 'Arrendatario/a capturado/a', blocking: true, appliesToRole: 'TENANT' },
  { code: 'PARTY_GUARANTOR', label: 'Obligado solidario capturado', blocking: true, appliesToRole: 'GUARANTOR' },
  { code: 'LEASE_TERMS', label: 'Renta, depósito, vigencia y forma de pago', blocking: true },
  { code: 'DOC_LANDLORD_ID', label: 'Identificación del arrendador', blocking: true, appliesToRole: 'LANDLORD' },
  { code: 'DOC_TENANT_ID', label: 'Identificación del arrendatario', blocking: true, appliesToRole: 'TENANT' },
  { code: 'DOC_GUARANTOR_ID', label: 'Identificación del obligado solidario', blocking: true, appliesToRole: 'GUARANTOR' },
  { code: 'DOC_PROPERTY_TITLE', label: 'Documento que acredita propiedad', blocking: true },
  { code: 'GUARANTEE_PROPERTY', label: 'Inmueble y documento ofrecidos en garantía', blocking: false, appliesToRole: 'GUARANTOR' },
];

const requirementCatalog = [
  ...leaseRequirements.map((item, index) => ({ ...item, matterKind: MatterKind.LEASE, sortOrder: (index + 1) * 10 })),
  ...[
    { code: 'LINKED_LEASE', label: 'Contrato de arrendamiento relacionado', blocking: true },
    { code: 'MEDIATION_DATA', label: 'Número, expediente, fecha y facilitador', blocking: true },
    ...leaseRequirements.filter((item) => item.code !== 'LEASE_TERMS'),
    { code: 'DOC_LEASE_ANNEX', label: 'Contrato agregado como Anexo 1', blocking: true },
  ].map((item, index) => ({ ...item, matterKind: MatterKind.MEDIATION_AGREEMENT, sortOrder: (index + 1) * 10 })),
];

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'demo-despacho' },
    update: {},
    create: { name: 'Despacho Demo', slug: 'demo-despacho' },
  });

  const user = await prisma.user.upsert({
    where: { email: 'admin@demo.local' },
    update: {},
    create: {
      email: 'admin@demo.local',
      displayName: 'Administrador Demo',
      passwordHash: await hash('Demo123!', 12),
    },
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id,
      },
    },
    update: { role: MembershipRole.ADMIN },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: MembershipRole.ADMIN,
    },
  });

  for (const requirement of requirementCatalog) {
    await prisma.requirementDefinition.upsert({
      where: {
        organizationId_matterKind_code: {
          organizationId: organization.id,
          matterKind: requirement.matterKind,
          code: requirement.code,
        },
      },
      update: {},
      create: {
        ...requirement,
        organizationId: organization.id,
        completionMode: RequirementCompletionMode.AUTO,
      },
    });
  }

  console.info('Datos demo listos: admin@demo.local / Demo123!');
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
