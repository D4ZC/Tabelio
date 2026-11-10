import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { renderDocxTemplate } = require('../apps/api/dist/documents/docx-template.js');
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const template = readFileSync(resolve(projectRoot, 'apps/api/templates/lease-v1.docx'));
const output = resolve(projectRoot, 'artifacts/mvp2/contrato-arrendamiento-muestra.docx');

const values = {
  LANDLORD_NAME: 'María Ejemplo Propietaria',
  TENANT_NAME: 'Carlos Ejemplo Arrendatario',
  GUARANTOR_NAME: 'Jorge Ejemplo Obligado',
  PROPERTY_ADDRESS: 'Calle Demostración número 100, colonia Centro, C.P. 44100, Guadalajara, Jalisco, México',
  RENT_AMOUNT: '15,000.00',
  PAYMENT_METHOD: 'transferencia electrónica a la cuenta indicada por la arrendadora',
  START_DATE: '1 de noviembre de 2026',
  END_DATE: '31 de octubre de 2027',
  TOTAL_INITIAL_PAYMENT: '30,000.00',
  PREPAID_RENT_AMOUNT: '15,000.00',
  DEPOSIT_AMOUNT: '15,000.00',
  GUARANTEE_PROPERTY_ADDRESS: 'Avenida Garantía número 200, colonia Americana, C.P. 44160, Guadalajara, Jalisco, México',
  GUARANTEE_OWNERSHIP_EVIDENCE: 'escritura pública número 1234',
  EXECUTION_DATE: '9 de octubre de 2026',
  PROPERTY_USE: 'casa habitación',
  LANDLORD_HONORIFIC: 'la señora',
  LANDLORD_RELATIVE_ARTICLE: 'a la',
  LANDLORD_ROLE: 'La Arrendadora',
  LANDLORD_ROLE_WITH_COLON: 'La Arrendadora:',
  LANDLORD_OWNER_ADJECTIVE: 'propietaria',
  TENANT_HONORIFIC: 'el señor',
  TENANT_RELATIVE_ARTICLE: 'al',
  TENANT_ROLE: 'El Arrendatario',
  TENANT_ROLE_WITH_COLON: 'El Arrendatario:',
  TENANT_ONLY_ADJECTIVE_UPPER: 'EL ÚNICO',
  TENANT_CITED_ADJECTIVE: 'citado',
  TENANT_REQUIRED_ADJECTIVE: 'requerido',
  TENANT_AWARE_ADJECTIVE: 'enterado',
  GUARANTOR_HONORIFIC: 'el señor',
  GUARANTOR_ROLE: 'El Obligado Solidario',
  GUARANTOR_ROLE_NO_ARTICLE: 'Obligado Solidario',
  GUARANTOR_ROLE_WITH_COLON: 'El Obligado Solidario:',
};

writeFileSync(output, renderDocxTemplate(template, values));
console.log(output);
