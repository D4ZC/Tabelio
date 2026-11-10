import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { renderDocxTemplate } = require('../apps/api/dist/documents/docx-template.js');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(resolve(projectRoot, 'apps/api/templates/agreement-v1.docx'));
const output = resolve(projectRoot, 'artifacts/mvp2/convenio-mediacion-muestra.docx');

const people = {
  REQUESTING: {
    NAME: 'María Ejemplo Propietaria',
    HONORIFIC: 'la señora',
    HONORIFIC_NO_ARTICLE: 'señora',
    CAPABLE_ADJECTIVE: 'capacitada',
    ORIGIN_ADJECTIVE: 'originaria',
    PRONOUN: 'Misma',
    OWNER_ADJECTIVE: 'propietaria',
    BIRTH_CITY: 'Guadalajara',
    BIRTH_STATE: 'estado de Jalisco',
    MARITAL_STATUS: 'casada',
    OCCUPATION: 'profesionista',
    ADDRESS: 'Calle Propietaria número 10, C.P. 44100, Guadalajara, Jalisco, México',
    TAX_ID: 'EJPM800101ABC',
    IDENTIFICATION: 'INE número IDMEX10001',
  },
  COMPLEMENTARY: {
    NAME: 'Carlos Ejemplo Arrendatario',
    HONORIFIC: 'el señor',
    HONORIFIC_NO_ARTICLE: 'señor',
    CAPABLE_ADJECTIVE: 'capacitado',
    ORIGIN_ADJECTIVE: 'originario',
    PRONOUN: 'Mismo',
    OWNER_ADJECTIVE: 'propietario',
    BIRTH_CITY: 'Zapopan',
    BIRTH_STATE: 'estado de Jalisco',
    MARITAL_STATUS: 'soltero',
    OCCUPATION: 'comerciante',
    ADDRESS: 'Calle Arrendatario número 20, C.P. 45000, Zapopan, Jalisco, México',
    TAX_ID: 'EJAC820202DEF',
    IDENTIFICATION: 'INE número IDMEX20002',
  },
  GUARANTOR: {
    NAME: 'Jorge Ejemplo Obligado',
    HONORIFIC: 'el señor',
    HONORIFIC_NO_ARTICLE: 'señor',
    CAPABLE_ADJECTIVE: 'capacitado',
    ORIGIN_ADJECTIVE: 'originario',
    PRONOUN: 'Mismo',
    OWNER_ADJECTIVE: 'propietario',
    BIRTH_CITY: 'Tlaquepaque',
    BIRTH_STATE: 'estado de Jalisco',
    MARITAL_STATUS: 'casado',
    OCCUPATION: 'empresario',
    ADDRESS: 'Calle Obligado número 30, C.P. 45500, Tlaquepaque, Jalisco, México',
    TAX_ID: 'EJOJ790303GHI',
    IDENTIFICATION: 'INE número IDMEX30003',
  },
};

const values = {
  AGREEMENT_NUMBER: 'CONV-2026-001',
  CASE_FILE_NUMBER: 'EXP-MASC-2026-001',
  CENTER_NAME: 'Corporativo Clerc, Sociedad Civil',
  CENTER_ACCREDITATION_DISPLAY: '100 cien',
  FACILITATOR_NAME: 'Alejandro Jhovaney Ávila Gutiérrez Hermosillo',
  FACILITATOR_CERTIFICATION_DISPLAY: '244 doscientos cuarenta y cuatro',
  CERTIFIED_COPIES_DISPLAY: '3 tres',
  HEARING_TIME: '16:00 horas',
  HEARING_DAY: '1 uno',
  HEARING_MONTH: 'diciembre',
  HEARING_YEAR_DISPLAY: '2026 dos mil veintiséis',
  LEASE_EXECUTION_DAY_MONTH: '9 nueve de octubre',
  LEASE_EXECUTION_YEAR_DISPLAY: '2026 dos mil veintiséis',
  PROPERTY_ADDRESS: 'Calle Demostración número 100, colonia Centro, C.P. 44100, Guadalajara, Jalisco, México',
  LEASE_DURATION: '12 doce meses',
  LEASE_START_DATE: '1 uno de noviembre de 2026 dos mil veintiséis',
  LEASE_END_DATE: '31 treinta y uno de octubre de 2027 dos mil veintisiete',
  RENT_AMOUNT: '15,000.00',
  PAYMENT_METHOD: 'mediante transferencia electrónica a la cuenta indicada por la parte solicitante',
  PROPERTY_OWNERSHIP_EVIDENCE: 'escritura pública número 9876',
  GUARANTEE_PROPERTY_ADDRESS: 'Avenida Garantía número 200, colonia Americana, C.P. 44160, Guadalajara, Jalisco, México',
  GUARANTEE_OWNERSHIP_EVIDENCE: 'escritura pública número 1234',
  ...Object.fromEntries(
    Object.entries(people).flatMap(([prefix, fields]) =>
      Object.entries(fields).map(([name, value]) => [`${prefix}_${name}`, value]),
    ),
  ),
};

writeFileSync(output, renderDocxTemplate(template, values));
console.log(output);
