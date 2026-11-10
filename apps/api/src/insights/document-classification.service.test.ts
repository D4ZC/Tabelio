import { Readable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { DocumentClassificationService } from './document-classification.service';

const user: AuthenticatedUser = {
  userId: 'user-1', organizationId: 'org-1', membershipId: 'member-1', email: 'fixture@example.test',
  displayName: 'Fixture', organizationName: 'Fixture Org', role: 'ADMIN',
};
const proof = 'COMPROBANTE DE DOMICILIO\nRECIBO DE AGUA\nTITULAR: PERSONA DE PRUEBA\nDOMICILIO: CALLE DE PRUEBA 10';
const identity = 'INSTITUTO NACIONAL ELECTORAL\nCREDENCIAL PARA VOTAR\nNOMBRE: PERSONA DE PRUEBA\nDOMICILIO: CALLE DE PRUEBA 10';

function setup() {
  const document = {
    id: 'document-1', organizationId: user.organizationId, matterId: 'matter-1' as string | null,
    type: 'OTHER', originalName: 'documento-prueba.pdf', objectKey: 'org-1/matter-1/document.pdf',
    mimeType: 'application/pdf', sizeBytes: 1024, invalidatedAt: null as Date | null,
    extractedData: null as unknown, extractionStatus: 'NOT_REQUESTED',
    personId: 'unverified-person', propertyId: 'unverified-property',
  };
  const matter = { id: 'matter-1', reference: 'DEMO-001', title: 'Expediente de prueba' };
  const prisma = {
    document: { findFirst: vi.fn().mockResolvedValue(document), update: vi.fn(), updateMany: vi.fn() },
    matter: { findFirst: vi.fn().mockResolvedValue(matter), update: vi.fn() },
    person: { findFirst: vi.fn(), update: vi.fn() }, property: { findFirst: vi.fn(), update: vi.fn() },
    documentExtractionRun: { findFirst: vi.fn().mockResolvedValue(null), create: vi.fn() },
    $transaction: vi.fn(),
  };
  const file = Buffer.from('%PDF-1.7 synthetic fixture');
  const storage = { open: vi.fn().mockImplementation(async () => Readable.from([file])) };
  const reader = { read: vi.fn().mockResolvedValue({
    documentKind: 'PROOF_OF_ADDRESS', text: proof, data: {}, method: 'pdf-text', message: 'Lectura local.',
  }) };
  const ai = { generate: vi.fn().mockResolvedValue({
    title: 'Propuesta con IA', summary: 'Se detectó un comprobante de domicilio.',
    items: [{ title: 'Indicio del texto', detail: 'El encabezado indica comprobante.', severity: 'info', sourceIds: ['document:document-1'] }],
    suggestedDocumentKind: 'PROOF_OF_ADDRESS',
  }) };
  const service = new DocumentClassificationService(prisma as never, storage as never, reader as never, ai as never);
  const reviewedText = (text: string, confirmedData: unknown = null) => prisma.documentExtractionRun.findFirst.mockResolvedValueOnce({
    rawData: { extractedText: text }, review: { confirmedData },
  });
  return { service, prisma, document, matter, storage, reader, ai, file, reviewedText };
}

function noMutations(prisma: ReturnType<typeof setup>['prisma']) {
  expect(prisma.document.update).not.toHaveBeenCalled();
  expect(prisma.document.updateMany).not.toHaveBeenCalled();
  expect(prisma.person.update).not.toHaveBeenCalled();
  expect(prisma.property.update).not.toHaveBeenCalled();
  expect(prisma.matter.update).not.toHaveBeenCalled();
  expect(prisma.documentExtractionRun.create).not.toHaveBeenCalled();
  expect(prisma.$transaction).not.toHaveBeenCalled();
}

describe('sugerencia local de clasificación documental', () => {
  it('prioriza texto revisado, limita consultas al documento y organización y cita evidencia estable', async () => {
    const { service, prisma, storage, reader, ai, reviewedText } = setup();
    reviewedText(proof);
    const result = await service.analyze(user, 'document-1');
    expect(prisma.document.findFirst.mock.calls[0][0].where).toEqual({ id: 'document-1', organizationId: 'org-1' });
    expect(prisma.matter.findFirst.mock.calls[0][0].where).toEqual({ id: 'matter-1', organizationId: 'org-1' });
    expect(prisma.documentExtractionRun.findFirst.mock.calls[0][0]).toMatchObject({ where: {
      documentId: 'document-1', organizationId: 'org-1',
      review: { is: { organizationId: 'org-1', decision: { in: ['CONFIRMED', 'CORRECTED'] } } },
    } });
    expect(result).toMatchObject({ kind: 'classification', mode: 'local', title: 'Clasificación actual: Otro', suggestion: { documentType: 'PROOF_OF_ADDRESS' } });
    expect(result.sources).toEqual([
      { id: 'document:document-1', label: 'documento-prueba.pdf' }, { id: 'matter:matter-1', label: 'Expediente DEMO-001' },
    ]);
    expect(result.items.every((item) => item.sourceIds.every((id) => result.sources.some((source) => source.id === id)))).toBe(true);
    expect(Number.isNaN(Date.parse(result.generatedAt))).toBe(false);
    expect(storage.open).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(result.suggestion).not.toHaveProperty('personId');
    expect(result.suggestion).not.toHaveProperty('propertyId');
    noMutations(prisma);
  });

  it('prefiere el texto corregido por la persona revisora sobre el rawData original', async () => {
    const { service, reviewedText, storage } = setup();
    reviewedText(identity, { extractedText: proof });
    expect((await service.analyze(user, 'document-1')).suggestion?.documentType).toBe('PROOF_OF_ADDRESS');
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('reutiliza texto confirmado del documento cuando la ejecución no contiene transcripción', async () => {
    const { service, document, storage, ai } = setup();
    document.extractionStatus = 'COMPLETE';
    document.extractedData = { extractedText: proof };
    const result = await service.analyze(user, document.id);
    expect(result.suggestion?.documentType).toBe('PROOF_OF_ADDRESS');
    expect(storage.open).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('distingue texto pendiente de revisión y excluye extracciones rechazadas o en proceso', async () => {
    const { service, prisma, storage } = setup();
    prisma.documentExtractionRun.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ rawData: { extractedText: proof } });
    const result = await service.analyze(user, 'document-1');
    expect(prisma.documentExtractionRun.findFirst.mock.calls[1][0].where).toEqual({
      documentId: 'document-1', organizationId: 'org-1', status: { in: ['COMPLETE', 'MANUAL_REVIEW'] }, review: { is: null },
    });
    expect(result.limitations.join(' ')).toContain('todavía no tiene revisión humana');
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('sin transcripción lee el original con el motor local y nunca consulta IA', async () => {
    const { service, reader, storage, ai, file, prisma } = setup();
    const result = await service.analyze(user, 'document-1');
    expect(storage.open).toHaveBeenCalledWith('org-1/matter-1/document.pdf');
    expect(reader.read).toHaveBeenCalledWith(file, 'application/pdf');
    expect(result.suggestion?.documentType).toBe('PROOF_OF_ADDRESS');
    expect(result.limitations.join(' ')).toContain('original localmente');
    expect(ai.generate).not.toHaveBeenCalled();
    noMutations(prisma);
  });

  it.each(['OTHER', 'TENANT_ID'])('una INE conserva el papel ya registrado sin inferirlo por el nombre del archivo (%s)', async (currentType) => {
    const { service, reviewedText, document, prisma } = setup();
    document.type = currentType;
    document.originalName = 'INE_arrendador_persona_conocida.pdf';
    reviewedText(identity);
    const result = await service.analyze(user, document.id);
    expect(result.suggestion).toEqual({ documentType: currentType });
    expect(result.summary).toContain(currentType === 'TENANT_ID' ? 'Se conserva el tipo ya registrado' : 'no demuestra el papel');
    expect(result.items[0].severity).toBe('warning');
    expect(prisma.person.findFirst).not.toHaveBeenCalled();
    expect(prisma.property.findFirst).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/unverified-person|unverified-property/);
  });

  it('no clasifica por el nombre del archivo cuando el texto carece de señales suficientes', async () => {
    const { service, reviewedText, document } = setup();
    document.originalName = 'comprobante-domicilio.pdf';
    reviewedText('Texto de otro documento sin indicios de una clasificación admitida.');
    expect((await service.analyze(user, document.id)).suggestion).toEqual({ documentType: 'OTHER' });
  });

  it('informa ausencia de texto local y rechaza IA sin evidencia antes de una llamada al proveedor', async () => {
    const { service, reader, ai } = setup();
    reader.read.mockResolvedValue({ documentKind: 'UNREADABLE', text: '', data: {}, method: 'ocr', message: 'Sin texto.' });
    const result = await service.analyze(user, 'document-1');
    expect(result.mode).toBe('local');
    expect(result.summary).toContain('No se obtuvo texto legible');
    expect(result.limitations.join(' ')).toContain('requiere clasificación manual');
    await expect(service.analyze(user, 'document-1', { mode: 'ai' })).rejects.toThrow('No hay texto suficiente');
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('permite analizar un documento sin expediente sin incorporar fuentes ajenas', async () => {
    const { service, document, prisma, reviewedText } = setup();
    document.matterId = null;
    reviewedText(proof);
    const result = await service.analyze(user, document.id);
    expect(result.sources).toEqual([{ id: 'document:document-1', label: 'documento-prueba.pdf' }]);
    expect(prisma.matter.findFirst).not.toHaveBeenCalled();
  });

  it.each(['foreign-document', 'invalidated-document', 'foreign-matter'])('rechaza %s antes de leer el archivo o enviar evidencia', async (scenario) => {
    const { service, document, prisma, storage, reader, ai } = setup();
    if (scenario === 'foreign-document') prisma.document.findFirst.mockResolvedValue(null);
    if (scenario === 'invalidated-document') document.invalidatedAt = new Date();
    if (scenario === 'foreign-matter') prisma.matter.findFirst.mockResolvedValue(null);
    await expect(service.analyze(user, document.id)).rejects.toThrow();
    expect(prisma.documentExtractionRun.findFirst).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('cierra el stream al detectar más de 20 MB aunque el tamaño declarado sea menor', async () => {
    const { service, storage, reader, ai } = setup();
    const stream = Readable.from([Buffer.alloc(20 * 1024 * 1024), Buffer.from('extra')]);
    storage.open.mockResolvedValue(stream);
    await expect(service.analyze(user, 'document-1')).rejects.toThrow('20 MB');
    expect(stream.destroyed).toBe(true);
    expect(reader.read).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('rechaza archivos declarados mayores que el límite antes de abrir el almacenamiento', async () => {
    const { service, document, storage } = setup();
    document.sizeBytes = 20 * 1024 * 1024 + 1;
    await expect(service.analyze(user, document.id)).rejects.toThrow('20 MB');
    expect(storage.open).not.toHaveBeenCalled();
  });

  it('un formato sin lector ni texto guardado queda sin evidencia y no llama IA', async () => {
    const { service, document, storage, reader, ai } = setup();
    document.mimeType = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const result = await service.analyze(user, document.id);
    expect(result.limitations.join(' ')).toContain('sólo admite PDF, JPG o PNG');
    expect(result.summary).toContain('clasificación fiable');
    await expect(service.analyze(user, document.id, { mode: 'ai' })).rejects.toThrow('No hay texto suficiente');
    expect(storage.open).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
  });

  it('un error de lectura local se comunica sin recurrir a IA', async () => {
    const { service, reader, ai, prisma } = setup();
    reader.read.mockRejectedValue(new Error('Lector no disponible'));
    await expect(service.analyze(user, 'document-1', { mode: 'ai' })).rejects.toThrow('Lector no disponible');
    expect(ai.generate).not.toHaveBeenCalled();
    noMutations(prisma);
  });
});

describe('clasificación con IA explícita y evidencia acotada', () => {
  it('envía texto y fuentes validadas, conserva citas y devuelve una sugerencia sin modificar registros', async () => {
    const { service, ai, reviewedText, storage, reader, prisma } = setup();
    reviewedText(proof);
    const result = await service.analyze(user, 'document-1', { mode: 'ai', conversationId: 'chat-1' });
    expect(ai.generate).toHaveBeenCalledWith(user, expect.objectContaining({
      kind: 'classification', documentId: 'document-1', conversationId: 'chat-1',
      sources: expect.arrayContaining([expect.objectContaining({ id: 'document:document-1', text: expect.stringContaining(proof) })]),
      localResult: expect.objectContaining({ title: 'Clasificación actual: Otro' }),
    }));
    expect(result).toMatchObject({ mode: 'ai', title: 'Propuesta con IA', suggestion: { documentType: 'PROOF_OF_ADDRESS' } });
    expect(result.items[0].sourceIds).toEqual(['document:document-1']);
    expect(result.sources.every((source) => !Object.hasOwn(source, 'text'))).toBe(true);
    expect(storage.open).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
    noMutations(prisma);
  });

  it.each(['OTHER', 'TENANT_ID'])('IDENTIFICATION conserva sólo un tipo de identificación ya registrado (%s)', async (currentType) => {
    const { service, document, reviewedText, ai } = setup();
    document.type = currentType;
    reviewedText(identity);
    ai.generate.mockResolvedValue({ title: 'Identificación', summary: 'Indicios de identificación.', items: [], suggestedDocumentKind: 'IDENTIFICATION' });
    const result = await service.analyze(user, document.id, { mode: 'ai' });
    expect(result.suggestion).toEqual({ documentType: currentType === 'TENANT_ID' ? 'TENANT_ID' : 'OTHER' });
    expect(result.limitations.join(' ')).toMatch(currentType === 'TENANT_ID' ? /conservó el tipo/ : /elegir manualmente el papel/);
    expect(result.suggestion).not.toHaveProperty('personId');
    expect(result.suggestion).not.toHaveProperty('propertyId');
  });

  it('no acepta IDs de personas o inmuebles incluidos arbitrariamente por la respuesta', async () => {
    const { service, reviewedText, ai, prisma } = setup();
    reviewedText(proof);
    ai.generate.mockResolvedValue({ title: 'Otro', summary: 'Revisar.', items: [], suggestedDocumentKind: 'OTHER', suggestion: { personId: 'foreign-person', propertyId: 'foreign-property' } } as never);
    const result = await service.analyze(user, 'document-1', { mode: 'ai' });
    expect(result.suggestion).toEqual({ documentType: 'OTHER' });
    expect(JSON.stringify(result)).not.toMatch(/foreign-person|foreign-property/);
    noMutations(prisma);
  });

  it('acota cada fuente antes de llamar IA y señala la pérdida de cobertura textual', async () => {
    const { service, document, reviewedText, ai } = setup();
    document.originalName = 'n'.repeat(400);
    reviewedText(`${proof}\n${'Texto de prueba. '.repeat(4000)}`);
    const result = await service.analyze(user, document.id, { mode: 'ai' });
    const sources = ai.generate.mock.calls[0][1].sources;
    expect(sources.every((source: { text: string; label: string }) => source.text.length <= 6000 && source.label.length <= 200)).toBe(true);
    expect(sources.reduce((sum: number, source: { text: string }) => sum + source.text.length, 0)).toBeLessThanOrEqual(40000);
    expect(result.limitations.join(' ')).toContain('30000 caracteres');
    expect(result.limitations.join(' ')).toContain('puede omitir partes');
  });

  it('un error de IA no aplica la clasificación ni vuelve a leer el original', async () => {
    const { service, reviewedText, ai, reader, storage, prisma } = setup();
    reviewedText(proof);
    ai.generate.mockRejectedValue(new Error('IA no disponible'));
    await expect(service.analyze(user, 'document-1', { mode: 'ai' })).rejects.toThrow('IA no disponible');
    expect(reader.read).not.toHaveBeenCalled();
    expect(storage.open).not.toHaveBeenCalled();
    noMutations(prisma);
  });

  it.each(['automatic', 'AI', '', ['ai']])('rechaza modo inválido antes de consultar datos: %s', async (mode) => {
    const { service, prisma, ai, reader } = setup();
    await expect(service.analyze(user, 'document-1', { mode: mode as never })).rejects.toThrow('análisis local o con IA');
    expect(prisma.document.findFirst).not.toHaveBeenCalled();
    expect(ai.generate).not.toHaveBeenCalled();
    expect(reader.read).not.toHaveBeenCalled();
  });
});
