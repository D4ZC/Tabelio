import { BadRequestException, ConflictException } from '@nestjs/common';

export const IDENTITY_DOCUMENT_TYPES = new Set(['LANDLORD_ID', 'TENANT_ID', 'GUARANTOR_ID']);

export const IDENTITY_FIELDS = [
  'legalName', 'givenName', 'familyName', 'curp', 'birthDate', 'gender',
  'addressLine1', 'addressLine2', 'city', 'state', 'postalCode',
  'identificationType', 'identificationNumber',
] as const;

export type IdentityField = typeof IDENTITY_FIELDS[number];

export function identityData(value: unknown): Partial<Record<IdentityField, string>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Los datos de la identificación deben ser un objeto.');
  }
  const result: Partial<Record<IdentityField, string>> = {};
  for (const field of IDENTITY_FIELDS) {
    const text = (value as Record<string, unknown>)[field];
    if (text === null || text === undefined || text === '') continue;
    if (typeof text !== 'string' || text.trim().length > 300) {
      throw new BadRequestException(`El campo ${field} no tiene un valor válido.`);
    }
    const cleaned = text.trim();
    if (!cleaned) continue;
    if (field === 'birthDate' && (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)
      || Number.isNaN(Date.parse(cleaned))
      || new Date(cleaned).toISOString().slice(0, 10) !== cleaned)) {
      throw new BadRequestException('La fecha de nacimiento no es válida.');
    }
    if (field === 'curp' && !/^[A-Z0-9]{18}$/.test(cleaned.toUpperCase())) {
      throw new BadRequestException('Revisa la CURP: debe contener 18 caracteres alfanuméricos.');
    }
    result[field] = field === 'curp' ? cleaned.toUpperCase() : cleaned;
  }
  return result;
}

export function identityPersonChanges(options: {
  data: Record<string, unknown>;
  fields: string[];
  overwriteFields?: string[];
  expectedValues?: Record<string, unknown>;
  person: Record<string, unknown>;
}) {
  const data = identityData(options.data);
  const changes: Partial<Record<IdentityField, string | Date>> = {};
  for (const field of options.fields) {
    if (!IDENTITY_FIELDS.includes(field as IdentityField) || !data[field as IdentityField]) {
      throw new BadRequestException('Selecciona únicamente campos de identificación con datos confirmados.');
    }
    const key = field as IdentityField;
    const current = identityPersonValue(options.person[key]);
    const incoming = data[key]!;
    if (current === incoming) continue;
    const expected = options.expectedValues?.[key];
    if (expected !== undefined && expected !== current) {
      throw new ConflictException('La ficha cambió desde que la abriste. Actualiza la revisión antes de guardar.');
    }
    if (current && (!options.overwriteFields?.includes(key) || expected === undefined)) {
      throw new ConflictException(`El campo ${key} ya tiene información. Confirma expresamente su reemplazo.`);
    }
    changes[key] = key === 'birthDate' ? new Date(`${incoming}T00:00:00.000Z`) : incoming;
  }
  return changes;
}

export function identityPersonValue(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value === null || value === undefined ? '' : String(value).trim();
}
