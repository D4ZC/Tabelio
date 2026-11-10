import type { Person } from './types';

export const IDENTITY_DOCUMENT_TYPES = ['LANDLORD_ID', 'TENANT_ID', 'GUARANTOR_ID'];

export const IDENTITY_FIELD_LABELS = {
  legalName: 'Nombre completo',
  givenName: 'Nombre(s)',
  familyName: 'Apellidos',
  curp: 'CURP',
  birthDate: 'Fecha de nacimiento',
  gender: 'Sexo / género impreso',
  addressLine1: 'Calle y número',
  addressLine2: 'Colonia / complemento del domicilio',
  city: 'Ciudad o municipio',
  state: 'Estado',
  postalCode: 'Código postal',
  identificationType: 'Tipo de identificación',
  identificationNumber: 'Número CIC, si aparece',
} as const;

export type IdentityField = keyof typeof IDENTITY_FIELD_LABELS;

export const IDENTITY_FIELDS = Object.keys(IDENTITY_FIELD_LABELS) as IdentityField[];

export function personIdentityValue(person: Person | undefined, field: IdentityField) {
  const value = person?.[field];
  if (!value) return '';
  return field === 'birthDate' ? String(value).slice(0, 10) : String(value).trim();
}

export function initialIdentityValues(data?: Record<string, unknown>) {
  return Object.fromEntries(IDENTITY_FIELDS.map((field) => [
    field, typeof data?.[field] === 'string' ? String(data[field]) : '',
  ])) as Record<IdentityField, string>;
}
