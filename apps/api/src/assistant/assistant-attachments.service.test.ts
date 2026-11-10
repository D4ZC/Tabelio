import { ConfigService } from '@nestjs/config';
import { MembershipRole } from '@despacho/database';
import { validate } from 'class-validator';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthenticatedUser } from '../auth/auth.types';
import { AssistantAttachmentsService, SAVE_ATTACHMENT_TOOL } from './assistant-attachments.service';
import { AssistantService, toolRequiresConfirmation } from './assistant.service';
import { AssistantController } from './assistant.controller';
import { AssistantConversationQueryDto } from './dto/assistant.dto';

const user: AuthenticatedUser = {
  userId: 'usuario-1', membershipId: 'miembro-1', organizationId: 'organizacion-1',
  email: 'prueba@example.test', displayName: 'Usuario de prueba', organizationName: 'Prueba', role: MembershipRole.ADMIN,
};

function file(mimetype = 'image/png', buffer = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1])) {
  return { originalname: 'documento-prueba.png', mimetype, buffer, size: buffer.length } as Express.Multer.File;
}

function response(documentKind = 'INE', fields: Record<string, unknown> = { legalName: 'Persona de prueba', addressLine1: 'Calle de prueba 10' }) {
  return { output: [], output_text: JSON.stringify({ documentKind, fields }) };
}

function fixture(usage?: unknown) {
  const provider = { createResponse: vi.fn().mockResolvedValue(response()) };
  const document = { id: 'documento-1', organizationId: user.organizationId, matterId: 'expediente-1' };
  const documents = {
    upload: vi.fn().mockResolvedValue(document),
    recordExtraction: vi.fn().mockResolvedValue({ document, run: { id: 'lectura-1' } }),
  };
  const config = new ConfigService({ DOCUMENT_EXTRACTION_ENABLED: 'true', ASSISTANT_ENABLED: 'true', ASSISTANT_API_KEY: 'test-only' });
  const localReader = { read: vi.fn().mockResolvedValue({
    documentKind: 'OTHER', data: {}, text: 'Texto local para revisión humana.', method: 'ocr', message: 'Lectura local.',
  }) };
  const service = new AssistantAttachmentsService(provider as never, documents as never, config, usage as never, localReader as never);
  const remote = { tools: [], callTool: vi.fn().mockResolvedValue({ structuredContent: { ok: true } }), close: vi.fn().mockResolvedValue(undefined) };
  const session = service.wrapSession(remote, user);
  return { provider, documents, config, service, session, remote, localReader };
}

function stageAi(service: AssistantAttachmentsService, principal: AuthenticatedUser, files?: Express.Multer.File[], conversationId?: string) {
  return service.stage(principal, files, conversationId, 'ai');
}

afterEach(() => vi.restoreAllMocks());

describe('lectura local y selección explícita de IA', () => {
  it('lee localmente por omisión aunque la IA esté deshabilitada, sin proveedor ni consumo de IA', async () => {
    const usage = { assertConversation: vi.fn(), createConversation: vi.fn(), runOperation: vi.fn() };
    const { service, localReader, provider, config } = fixture(usage);
    config.set('DOCUMENT_EXTRACTION_ENABLED', 'false');
    config.set('ASSISTANT_ENABLED', 'false');
    config.set('ASSISTANT_API_KEY', '');
    const original = file();
    const { attachments: [preview] } = await service.stage(user, [original]);
    expect(localReader.read).toHaveBeenCalledWith(original.buffer, original.mimetype);
    expect(preview).toMatchObject({
      extractionMode: 'local', extractionMethod: 'ocr', provider: 'local-ocr',
      text: 'Texto local para revisión humana.', documentKind: 'OTHER', data: {},
    });
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(usage.createConversation).not.toHaveBeenCalled();
    expect(usage.runOperation).not.toHaveBeenCalled();
    expect(service.context(user, [preview.id])[0]).not.toHaveProperty('text');
    expect(JSON.stringify(service.context(user, [preview.id]))).not.toContain(preview.text);
  });

  it.each([
    ['pdf-text', 'local-pdf-text'], ['ocr', 'local-ocr'], ['mixed', 'local-ocr'],
  ])('guarda texto local de %s para revisión sin exigir campos personales', async (method, providerName) => {
    const { service, localReader, documents, session, provider } = fixture();
    localReader.read.mockResolvedValue({ documentKind: 'OTHER', data: {}, text: 'Cláusula leída localmente.', method, message: 'Revisar texto.' });
    const original = file();
    const { attachments: [preview] } = await service.stage(user, [original], undefined, 'local');
    const result = await session.callTool(SAVE_ATTACHMENT_TOOL, {
      attachmentId: preview.id, matterId: 'expediente-1', type: 'OTHER',
    });
    expect(result.isError).not.toBe(true);
    expect(documents.recordExtraction).toHaveBeenCalledWith(user, expect.anything(), expect.objectContaining({
      status: 'MANUAL_REVIEW', provider: providerName, data: { extractedText: 'Cláusula leída localmente.' }, fields: [],
    }));
    expect(documents.upload).toHaveBeenCalledWith(user, 'expediente-1', expect.anything(), original);
    expect(JSON.stringify(result)).not.toContain('Cláusula leída localmente.');
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(localReader.read).toHaveBeenCalledOnce();
  });

  it('el texto local ilegible permanece fallido y no inicia una lectura con IA', async () => {
    const { service, localReader, documents, session, provider } = fixture();
    localReader.read.mockResolvedValue({ documentKind: 'UNREADABLE', data: {}, text: '  ', method: 'ocr', message: 'Sin texto legible.' });
    const { attachments: [preview] } = await service.stage(user, [file()]);
    await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: preview.id, matterId: 'expediente-1', type: 'OTHER' });
    expect(documents.recordExtraction.mock.calls[0][2]).toMatchObject({ status: 'FAILED', provider: 'local-ocr' });
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('un error del lector libera los adjuntos sin recurrir al proveedor de IA', async () => {
    const { service, localReader, provider } = fixture();
    localReader.read.mockRejectedValueOnce(new Error('Lector local no disponible'));
    await expect(service.stage(user, [file(), file()])).rejects.toThrow('Lector local no disponible');
    const result = await service.stage(user, [file(), file(), file()]);
    expect(result.activeAttachmentIds).toHaveLength(3);
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('valida el propietario del chat local antes de leer, sin crear operaciones de IA', async () => {
    const usage = { assertConversation: vi.fn().mockRejectedValue(new Error('Conversación no encontrada')), runOperation: vi.fn() };
    const { service, localReader, provider } = fixture(usage);
    await expect(service.stage(user, [file()], 'foreign')).rejects.toThrow('Conversación no encontrada');
    expect(localReader.read).not.toHaveBeenCalled();
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(usage.runOperation).not.toHaveBeenCalled();
  });

  it('no sustituye un lector local ausente por una inferencia de IA', async () => {
    const { provider, documents, config } = fixture();
    const service = new AssistantAttachmentsService(provider as never, documents as never, config);
    await expect(service.stage(user, [file()])).rejects.toThrow('lectura local no está disponible');
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('la lectura local conserva permisos y validación del archivo', async () => {
    const { service, localReader, provider } = fixture();
    await expect(service.stage({ ...user, role: MembershipRole.VIEWER }, [file()])).rejects.toThrow('permiso');
    await expect(service.stage(user, [file('image/png', Buffer.from('archivo inválido'))])).rejects.toThrow('PDF, JPG o PNG válido');
    expect(localReader.read).not.toHaveBeenCalled();
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it.each(['ASSISTANT_ENABLED', 'ASSISTANT_API_KEY'])('sólo el modo IA exige %s', async (setting) => {
    const { service, config, provider, localReader } = fixture();
    config.set(setting, '');
    await expect(stageAi(service, user, [file()])).rejects.toThrow();
    await expect(service.stage(user, [file()])).resolves.toBeDefined();
    expect(provider.createResponse).not.toHaveBeenCalled();
    expect(localReader.read).toHaveBeenCalledOnce();
  });

  it.each(['automatic', 'AI', '', ['ai']])('rechaza un modo inválido sin lectura: %s', async (mode) => {
    const { service, localReader, provider } = fixture();
    const query = Object.assign(new AssistantConversationQueryDto(), { extractionMode: mode });
    expect(await validate(query)).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'extractionMode' })]));
    await expect(service.stage(user, [file()], undefined, mode as never)).rejects.toThrow('lectura local o con IA');
    expect(localReader.read).not.toHaveBeenCalled();
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('el controlador transmite sólo la selección explícita y usa local por omisión', async () => {
    const attachments = { stage: vi.fn() };
    const controller = new AssistantController({} as never, attachments as never);
    const original = file();
    controller.uploadAttachments(user, {}, [original]);
    controller.uploadAttachments(user, { conversationId: 'chat-1', extractionMode: 'ai' }, [original]);
    expect(attachments.stage.mock.calls).toEqual([
      [user, [original], undefined, 'local'], [user, [original], 'chat-1', 'ai'],
    ]);
    expect(await validate(Object.assign(new AssistantConversationQueryDto(), { extractionMode: 'local' }))).toEqual([]);
    expect(await validate(Object.assign(new AssistantConversationQueryDto(), { extractionMode: 'ai' }))).toEqual([]);
  });
});

describe('adjuntos temporales del chat', () => {
  it('atribuye cada lectura al chat antes del mensaje y no vuelve a contar al guardar o descartar', async () => {
    const conversationId = '646e0d2c-dd85-41c4-9033-1c74f75a76dd';
    const usage = {
      assertConversation: vi.fn().mockResolvedValue(undefined),
      runOperation: vi.fn(async (_user, _operation, callback: () => Promise<unknown>) => callback()),
    };
    const { service, session, provider } = fixture(usage);
    const { attachments: [first, second] } = await stageAi(service, user, [file(), file()], conversationId);
    expect(usage.assertConversation).toHaveBeenCalledWith(conversationId, user);
    expect(usage.runOperation.mock.calls.map(([owner, operation]) => ({ owner, operation }))).toEqual([
      { owner: user, operation: { conversationId, kind: 'DOCUMENT_EXTRACTION', label: 'Lectura de adjunto 1' } },
      { owner: user, operation: { conversationId, kind: 'DOCUMENT_EXTRACTION', label: 'Lectura de adjunto 2' } },
    ]);
    await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: first.id, matterId: 'expediente-1', type: 'TENANT_ID' });
    service.discard(second.id, user);
    expect(usage.runOperation).toHaveBeenCalledTimes(2);
    expect(provider.createResponse).toHaveBeenCalledTimes(2);
  });

  it('una conversación no autorizada falla antes de leer documentos y libera el cupo temporal', async () => {
    const usage = {
      assertConversation: vi.fn().mockRejectedValueOnce(new Error('Conversación no encontrada')).mockResolvedValue(undefined),
      runOperation: vi.fn(async (_user, _operation, callback: () => Promise<unknown>) => callback()),
    };
    const { service, provider } = fixture(usage);
    await expect(stageAi(service, user, [file()], 'foreign')).rejects.toThrow('Conversación no encontrada');
    expect(provider.createResponse).not.toHaveBeenCalled();
    await expect(stageAi(service, user, [file()], 'owned')).resolves.toBeDefined();
    expect(provider.createResponse).toHaveBeenCalledOnce();
  });

  it('clasifica y muestra datos preliminares sin guardar documentos ni modificar personas', async () => {
    const { service, documents, provider, localReader } = fixture();
    const staged = await stageAi(service, user, [file()]);
    expect(staged.attachments[0]).toMatchObject({
      extractionMode: 'ai', provider: 'vision',
      documentKind: 'INE', data: { legalName: 'Persona de prueba' }, message: expect.stringContaining('No se ha guardado'),
    });
    expect(localReader.read).not.toHaveBeenCalled();
    expect(documents.upload).not.toHaveBeenCalled();
    expect(documents.recordExtraction).not.toHaveBeenCalled();
    expect(provider.createResponse).toHaveBeenCalledWith(expect.objectContaining({ tools: [], toolChoice: 'none' }));
    expect(JSON.stringify(provider.createResponse.mock.calls)).toContain('data:image/png;base64,');
    expect(provider.createResponse.mock.calls[0][0].instructions).toContain('NO CONFIABLE');
  });

  it.each([
    ['application/pdf', Buffer.from('%PDF-1.7\nprueba')],
    ['image/jpeg', Buffer.from([255, 216, 255, 1])],
    ['image/png', file().buffer],
  ])('envía %s como archivo privado o imagen sin URL pública', async (mimetype, buffer) => {
    const { service, provider } = fixture();
    await stageAi(service, user, [file(mimetype, buffer)]);
    const media = provider.createResponse.mock.calls[0][0].input[0].content[1];
    expect(media.type).toBe(mimetype === 'application/pdf' ? 'input_file' : 'input_image');
    expect(JSON.stringify(media)).toContain(`data:${mimetype};base64,`);
  });

  it('identifica comprobantes y descarta campos propios de una identificación', async () => {
    const { service, provider } = fixture();
    provider.createResponse.mockResolvedValue(response('PROOF_OF_ADDRESS', {
      legalName: 'Titular distinto', addressLine1: 'Calle 10', city: null,
      curp: 'DEMO900101HDFXXX09', identificationType: 'INE', birthDate: '1990-01-01',
    }));
    const result = await stageAi(service, user, [file()]);
    expect(result.attachments[0]).toMatchObject({ documentKind: 'PROOF_OF_ADDRESS', data: { legalName: 'Titular distinto', addressLine1: 'Calle 10' } });
    expect(result.attachments[0].data).not.toHaveProperty('curp');
    expect(result.attachments[0].data).not.toHaveProperty('birthDate');
    expect(result.attachments[0].data).not.toHaveProperty('city');
  });

  it.each(['OTHER', 'UNREADABLE'])('no conserva datos personales cuando el documento es %s', async (kind) => {
    const { service, provider } = fixture();
    provider.createResponse.mockResolvedValue(response(kind));
    const result = await stageAi(service, user, [file()]);
    expect(result.attachments[0].data).toEqual({});
  });

  it('no inventa datos cuando la respuesta no es válida', async () => {
    const { service, provider } = fixture();
    provider.createResponse.mockResolvedValue({ output: [], output_text: 'no es JSON' });
    expect((await stageAi(service, user, [file()])).attachments[0]).toMatchObject({ documentKind: 'UNREADABLE', data: {} });
  });

  it.each([
    file('image/png', Buffer.from('no es una imagen')),
    file('application/pdf', file().buffer),
    file('application/msword'),
    file('image/png', Buffer.alloc(0)),
    file('image/png', Buffer.alloc(20 * 1024 * 1024 + 1)),
  ])('rechaza archivos inválidos antes de consultar al proveedor', async (invalidFile) => {
    const { service, provider } = fixture();
    await expect(stageAi(service, user, [invalidFile])).rejects.toThrow();
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('exige permiso de carga y activación explícita de la extracción', async () => {
    const { service, config, provider } = fixture();
    await expect(stageAi(service, { ...user, role: MembershipRole.VIEWER }, [file()])).rejects.toThrow('permiso');
    config.set('DOCUMENT_EXTRACTION_ENABLED', 'false');
    await expect(stageAi(service, user, [file()])).rejects.toThrow('DOCUMENT_EXTRACTION_ENABLED');
    expect(provider.createResponse).not.toHaveBeenCalled();
  });

  it('limita a tres archivos por mensaje y seis temporales por usuario', async () => {
    const { service } = fixture();
    await expect(stageAi(service, user, [])).rejects.toThrow('uno y tres');
    await expect(stageAi(service, user, [file(), file(), file(), file()])).rejects.toThrow('uno y tres');
    await stageAi(service, user, [file(), file(), file()]);
    await stageAi(service, user, [file(), file(), file()]);
    await expect(stageAi(service, user, [file()])).rejects.toThrow('límite de adjuntos');
  });

  it('aísla los adjuntos por usuario, membresía y organización', async () => {
    const { service } = fixture();
    const { attachments: [preview] } = await stageAi(service, user, [file()]);
    for (const changes of [{ userId: 'otro' }, { membershipId: 'otro' }, { organizationId: 'otra' }]) {
      const other = { ...user, ...changes };
      expect(service.context(other, [preview.id])).toEqual([]);
      expect(() => service.discard(preview.id, other)).toThrow('no existe o venció');
    }
    expect(service.context(user, [preview.id])).toHaveLength(1);
  });

  it('descarta adjuntos vencidos o retirados sin bloquear conversaciones posteriores', async () => {
    const { service, session, documents } = fixture();
    const { attachments: [first, second] } = await stageAi(service, user, [file(), file()]);
    service.discard(first.id, user);
    expect(service.context(user, [first.id, second.id])).toHaveLength(1);
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse(second.expiresAt) + 1);
    expect(service.context(user, [second.id])).toEqual([]);
    expect(await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: second.id, matterId: 'expediente-1', type: 'TENANT_ID' })).toMatchObject({ isError: true });
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('libera los archivos temporales si falla el proveedor a mitad de un lote', async () => {
    const { service, provider, documents } = fixture();
    provider.createResponse.mockResolvedValueOnce(response()).mockRejectedValueOnce(new Error('Proveedor no disponible'));
    await expect(stageAi(service, user, [file(), file()])).rejects.toThrow('Proveedor no disponible');
    await expect(stageAi(service, user, [file(), file(), file()])).resolves.toBeDefined();
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it('conserva las herramientas remotas y sólo expone la carga con permisos', async () => {
    const { service, session, remote } = fixture();
    expect(toolRequiresConfirmation(session.tools[0])).toBe(true);
    await session.callTool('otra_herramienta', { prueba: true }, 500);
    expect(remote.callTool).toHaveBeenCalledWith('otra_herramienta', { prueba: true }, 500);
    await session.close();
    expect(remote.close).toHaveBeenCalledOnce();
    expect(service.wrapSession(remote, { ...user, role: MembershipRole.VIEWER }).tools).toEqual([]);
  });
});

describe('guardado de adjuntos confirmado', () => {
  it('guarda el original y registra la misma extracción para revisión sin volver a leerlo', async () => {
    const { service, session, documents, provider } = fixture();
    const original = file();
    const { attachments: [preview] } = await stageAi(service, user, [original]);
    const args = { attachmentId: preview.id, matterId: 'expediente-1', personId: 'persona-1', type: 'TENANT_ID' };
    expect(service.summary(user, args)).toContain('Persona de prueba');
    const result = await session.callTool(SAVE_ATTACHMENT_TOOL, args);
    expect(result.isError).not.toBe(true);
    expect(documents.upload).toHaveBeenCalledWith(user, 'expediente-1', expect.objectContaining({ type: 'TENANT_ID', personId: 'persona-1' }), original);
    expect(documents.recordExtraction).toHaveBeenCalledWith(user, expect.objectContaining({ id: 'documento-1' }), expect.objectContaining({ status: 'MANUAL_REVIEW', data: preview.data }));
    expect(provider.createResponse).toHaveBeenCalledOnce();
    expect(service.context(user, [preview.id])).toEqual([]);
    expect(await session.callTool(SAVE_ATTACHMENT_TOOL, args)).toMatchObject({ isError: true });
    expect(documents.upload).toHaveBeenCalledOnce();
  });

  it('conserva el adjunto si falla el guardado por duplicado o expediente cerrado', async () => {
    const { service, session, documents } = fixture();
    const { attachments: [preview] } = await stageAi(service, user, [file()]);
    documents.upload.mockRejectedValue(new Error('Documento duplicado'));
    expect(await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: preview.id, matterId: 'expediente-1', type: 'TENANT_ID' })).toMatchObject({ isError: true });
    expect(service.context(user, [preview.id])).toHaveLength(1);
    expect(documents.recordExtraction).not.toHaveBeenCalled();
  });

  it('informa un guardado parcial sin invitar a duplicar el archivo', async () => {
    const { service, session, documents } = fixture();
    const { attachments: [preview] } = await stageAi(service, user, [file()]);
    documents.recordExtraction.mockRejectedValue(new Error('base de datos'));
    const result = await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: preview.id, matterId: 'expediente-1', type: 'TENANT_ID' });
    expect(result).toMatchObject({ structuredContent: { warning: expect.stringContaining('archivo sí se guardó') } });
    expect(service.context(user, [preview.id])).toEqual([]);
  });

  it.each(['SIGNED_CONTRACT', 'PROOF_OF_ADDRESS', 'desconocido'])('no clasifica una INE como %s', async (type) => {
    const { service, session, documents } = fixture();
    const { attachments: [preview] } = await stageAi(service, user, [file()]);
    expect(await session.callTool(SAVE_ATTACHMENT_TOOL, { attachmentId: preview.id, matterId: 'expediente-1', type })).toMatchObject({ isError: true });
    expect(documents.upload).not.toHaveBeenCalled();
  });

  it.each([true, false])('el flujo real del asistente sólo guarda al confirmar: %s', async (approved) => {
    const { service, documents, provider, config, remote } = fixture();
    const { attachments: [preview] } = await stageAi(service, user, [file()]);
    const args = { attachmentId: preview.id, matterId: 'expediente-1', personId: 'persona-1', type: 'TENANT_ID' };
    provider.createResponse.mockResolvedValueOnce({ output: [{
      type: 'function_call', call_id: 'guardar-adjunto', name: SAVE_ATTACHMENT_TOOL, arguments: JSON.stringify(args),
    }] } as never).mockResolvedValueOnce({ output: [], output_text: 'Documento guardado y lectura pendiente.' });
    const mcp = { connect: vi.fn().mockResolvedValue(remote) };
    const assistant = new AssistantService(provider as never, mcp as never, config, service);
    const first = await assistant.chat({
      messages: [{ role: 'user', content: 'Guarda esta INE en el expediente indicado como identificación del arrendatario.' }],
      attachmentIds: [preview.id],
    }, user, 'sesion-prueba');
    expect(first.pendingAction?.operations[0].summary).toContain('Persona de prueba');
    expect(documents.upload).not.toHaveBeenCalled();
    expect(JSON.stringify(provider.createResponse.mock.calls[1][0])).toContain(preview.id);
    const resolved = await assistant.resolveAction(first.pendingAction!.id, approved, user, 'sesion-prueba');
    expect(resolved.changed).toBe(approved);
    expect(documents.upload).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(documents.recordExtraction).toHaveBeenCalledTimes(approved ? 1 : 0);
  });
});
