import assert from 'node:assert/strict';
import test from 'node:test';
import { buildMatters, classifyFile, isCompany, matterDates, matterStatus, normKey, parseParties, splitNames } from './import-clerc.mjs';

test('separa titulares de representantes', () => {
  assert.deepEqual(parseParties('Caviace y Asociados, Sociedad Civil, por conducto de sus apoderados generales, con facultades suficientes, Licenciados Cesar Armando Gómez Sánchez y Carmen Adriana Vázquez Becerra'),
    { principals: ['Caviace y Asociados, Sociedad Civil'], representatives: ['Cesar Armando Gómez Sánchez', 'Carmen Adriana Vázquez Becerra'] });
  assert.deepEqual(parseParties('SONIA DE LA ESPERANZA GONZÁLEZ RAMÍREZ, como apoderada general de la señora MARÍA GUADALUPE RAMÍREZ RUIZ'),
    { principals: ['MARÍA GUADALUPE RAMÍREZ RUIZ'], representatives: ['SONIA DE LA ESPERANZA GONZÁLEZ RAMÍREZ'] });
  assert.deepEqual(parseParties('Servando Sáenz de Miera Cruz por conducto de su apoderado legal Manuel Servando Sáenz de Miera Reyes'),
    { principals: ['Servando Sáenz de Miera Cruz'], representatives: ['Manuel Servando Sáenz de Miera Reyes'] });
  assert.deepEqual(parseParties('Candelario Banderas Mayorga, por su propio derecho, así como Idelika Importaciones, Sociedad Anónima de Capital Variable, por conducto de su Administrador General Único, señor Sergio Arguelles Martinez').principals,
    ['Candelario Banderas Mayorga', 'Idelika Importaciones, Sociedad Anónima de Capital Variable']);
  assert.deepEqual(parseParties('Jesús Roberto Martín Del Campo Vallejo y Lilianne Alejandrina Martín Del Campo Vallejo').principals,
    ['Jesús Roberto Martín Del Campo Vallejo', 'Lilianne Alejandrina Martín Del Campo Vallejo']);
});

test('descarta fechas de convenio con año incoherente', () => {
  const dates = matterDates({ requestDate: '2025-12-02', agreementDate: '2012-12-02', hour: '13:00' }, '1019/2025');
  assert.equal(dates.signedAt.toISOString(), '2025-12-02T19:00:00.000Z');
  assert.equal(dates.corrected, true);
  const ok = matterDates({ requestDate: '2025-11-20', agreementDate: '2025-12-02' }, '1019/2025');
  assert.equal(ok.signedAt.toISOString(), '2025-12-02T18:00:00.000Z');
  assert.equal(ok.corrected, false);
  // Año de convenio imposible ("47/2502"): no se usa para validar.
  assert.equal(matterDates({ requestDate: '2021-01-20', agreementDate: '2021-01-29' }, '47/2502').signedAt.toISOString().slice(0, 10), '2021-01-29');
});

test('normaliza nombres sin acentos ni puntuación', () => {
  assert.equal(normKey('  María  Pérez, S.A.  '), 'MARIA PEREZ S A');
});

test('separa personas físicas pero no razones sociales', () => {
  assert.deepEqual(splitNames('Jesús Martín Vallejo y Lilianne Martín Vallejo'), ['Jesús Martín Vallejo', 'Lilianne Martín Vallejo']);
  assert.deepEqual(splitNames('Caviace y Asociados, Sociedad Civil'), ['Caviace y Asociados, Sociedad Civil']);
  assert.ok(isCompany('Banco Mercantil del Norte, Sociedad Anónima'));
  assert.ok(!isCompany('Carlos Alberto Valencia Sánchez'));
  assert.deepEqual(splitNames(''), []);
});

test('clasifica documentos por nombre de archivo', () => {
  assert.equal(classifyFile('CONVENIOS 2025/X/5976 CONVENIO.pdf'), 'AGREEMENT_PDF');
  assert.equal(classifyFile('CONVENIOS 2025/X/1019-2025 5976 CONVENIO.doc'), 'OTHER');
  assert.equal(classifyFile('CONVENIOS 2025/X/5976 CARATULA CONVENIOS.doc'), 'OTHER');
  assert.equal(classifyFile('CONVENIOS 2025/X/Documentos/CONTRATO ADM..pdf'), 'LEASE');
  assert.equal(classifyFile('CONVENIOS 2025/X/Documentos/PREDIAL 2025.pdf'), 'PROPERTY_TITLE');
  assert.equal(classifyFile('CONVENIOS 2025/X/Documentos/INE JESUS.pdf'), 'ID');
});

const folder = (over) => ({ path: 'CONVENIOS 2025/1019-2025 EXP 5976 CAVIACE', name: '1019-2025 EXP 5976 CAVIACE', year: 2025,
  state: null, kind: 'AGREEMENT', parsed: { exp: '5976', agreement: '1019/2025', label: 'CAVIACE' }, files: [], ...over });

test('une filas del registro y carpetas por número de expediente', () => {
  const matters = buildMatters({
    register: [
      { sheet: '2025', row: 9, exp: '5976', agreement: '1019/2025', process: 'IJA' },
      { sheet: '2024', row: 3, exp: '5976', agreement: null, process: 'SE PASA 2025' },
      { sheet: '2018', row: 4, exp: null, agreement: '44/2018' },
    ],
    folders: [folder({}), folder({ path: 'CONVENIOS 2018/37-2018 X', parsed: { exp: null, agreement: '44/2018' } })],
  });
  const exp = matters.find((m) => m.reference === 'EXP 5976');
  assert.equal(exp.rows.length, 2);
  assert.equal(exp.row.agreement, '1019/2025');
  assert.equal(exp.folders.length, 1);
  assert.equal(matters.find((m) => m.reference === 'CONV 44/2018').folders.length, 1);
});

test('deduce el estado del expediente', () => {
  const base = { folders: [], rows: [] };
  assert.equal(matterStatus({ ...base, row: { process: 'CANCELADO', agreement: '1/2024' } }), 'CANCELLED');
  assert.equal(matterStatus({ ...base, row: { process: 'SE PASA A 2024', agreement: '1/2023' } }), 'CANCELLED');
  assert.equal(matterStatus({ ...base, row: { process: 'PENDIENTE FIRMA', agreement: '1/2026' } }), 'SIGNATURE');
  assert.equal(matterStatus({ ...base, row: { process: 'IJA' } }), 'INTEGRATION');
  assert.equal(matterStatus({ ...base, row: { process: 'IJA', agreement: '1/2020', agreementDate: '2020-01-01', expiry: '2021-01-01' } }), 'CLOSED');
  assert.equal(matterStatus({ ...base, row: { process: 'IJA', agreement: '1/2026', agreementDate: '2026-06-01', expiry: '2099-01-01' } }), 'ACTIVE');
  assert.equal(matterStatus({ ...base, row: null, folders: [folder({ state: 'CANCELLED' })] }), 'CANCELLED');
  assert.equal(matterStatus({ ...base, row: null, folders: [folder({ state: 'CONCLUDED', parsed: { exp: '1' } })] }), 'CLOSED');
});
