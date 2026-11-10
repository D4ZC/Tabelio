export type LocalDocumentKind = 'INE' | 'PROOF_OF_ADDRESS' | 'OTHER' | 'UNREADABLE';

/** Text is untrusted data. These rules transcribe explicit labels, never instructions. */
export function localDocumentFields(text: string): { documentKind: LocalDocumentKind; data: Record<string, string> } {
  const normalized = normalize(text);
  const ine = /INSTITUTO (?:NACIONAL|FEDERAL) ELECTORAL|CREDENCIAL PARA VOTAR/.test(normalized)
    && /\b(?:NOMBRE|CURP|DOMICILIO)\b/.test(normalized);
  const proof = /COMPROBANTE DE DOMICILIO|RECIBO (?:DE )?(?:LUZ|AGUA|TELEFONO|PREDIAL)|COMISION FEDERAL DE ELECTRICIDAD/.test(normalized);
  const documentKind: LocalDocumentKind = ine ? 'INE' : proof ? 'PROOF_OF_ADDRESS'
    : /[\p{L}\p{N}]/u.test(text) ? 'OTHER' : 'UNREADABLE';
  if (!ine && !proof) return { documentKind, data: {} };
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const data: Record<string, string> = {};
  const copy = (field: string, labels: RegExp, nextLine = false) => {
    const value = labeledValue(lines, labels, nextLine);
    if (value) data[field] = value;
  };
  // A plain NOMBRE on an INE can precede three unordered lines. Do not reorder or guess it.
  copy('legalName', /^(?:NOMBRE COMPLETO|NOMBRE DEL TITULAR|TITULAR|NOMBRE DEL CLIENTE|NOMBRE)$/, false);
  copy('addressLine1', /^(?:DOMICILIO|DIRECCION|CALLE Y NUMERO)$/, true);
  copy('addressLine2', /^(?:COLONIA|COMPLEMENTO|DOMICILIO LINEA 2)$/, true);
  copy('city', /^(?:CIUDAD|MUNICIPIO)$/, true);
  copy('state', /^ESTADO$/, true);
  const postal = labeledValue(lines, /^(?:C\.?\s?P\.?|CODIGO POSTAL)$/, true);
  if (postal && /^\d{5}$/.test(postal)) data.postalCode = postal;
  if (ine) {
    data.identificationType = /INSTITUTO FEDERAL ELECTORAL/.test(normalized) ? 'IFE' : 'INE';
    copy('givenName', /^(?:NOMBRES|NOMBRE\(S\))$/, false);
    copy('familyName', /^APELLIDOS?\(?S?\)?$/, false);
    const curp = labeledValue(lines, /^CURP$/, true)?.toUpperCase();
    if (curp && /^[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(curp)) data.curp = curp;
    const cic = labeledValue(lines, /^CIC$/, true);
    if (cic && /^\d{9}$/.test(cic)) data.identificationNumber = cic;
    const gender = labeledValue(lines, /^(?:SEXO|GENERO)$/, true);
    if (gender && /^(?:H|M|F|HOMBRE|MUJER)$/i.test(gender)) data.gender = gender;
    const date = labeledValue(lines, /^(?:FECHA DE NACIMIENTO|NACIMIENTO)$/, true);
    const iso = explicitBirthDate(date);
    if (iso) data.birthDate = iso;
  }
  return { documentKind, data };
}

function labeledValue(lines: string[], labels: RegExp, nextLine: boolean): string | undefined {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const separator = line.search(/[:：]/);
    if (separator >= 0 && labels.test(normalize(line.slice(0, separator)))) {
      const value = line.slice(separator + 1).trim();
      if (safeValue(value)) return value;
    }
    if (nextLine && labels.test(normalize(line)) && safeValue(lines[index + 1])) return lines[index + 1];
  }
  return undefined;
}

function safeValue(value: string | undefined): value is string {
  return Boolean(value && value.length <= 300 && !/[:：\u0000-\u0008]/.test(value)
    && !/^(?:NOMBRE(?: COMPLETO| DEL TITULAR| DEL CLIENTE|S|\(S\))?|TITULAR|APELLIDOS?|DOMICILIO(?: LINEA 2)?|DIRECCION|CALLE Y NUMERO|COLONIA|COMPLEMENTO|CURP|CIC|SEXO|GENERO|NACIMIENTO|FECHA DE NACIMIENTO|ESTADO|MUNICIPIO|CIUDAD|VIGENCIA|CLAVE DE ELECTOR|CODIGO POSTAL|C\.?\s?P\.?)$/.test(normalize(value)));
}

function explicitBirthDate(value: string | undefined): string | undefined {
  if (!value) return;
  const parts = value.match(/^(\d{2})[/-](\d{2})[/-](\d{4})$/);
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : parts ? `${parts[3]}-${parts[2]}-${parts[1]}` : undefined;
  if (!iso) return;
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : undefined;
}

function normalize(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().trim();
}
