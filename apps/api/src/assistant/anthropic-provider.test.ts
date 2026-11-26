import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicModel, fromAnthropicMessage, toAnthropicMessages, toAnthropicRequest } from './anthropic-provider';
import { AssistantProviderService } from './assistant-provider.service';

afterEach(() => {
  vi.unstubAllGlobals();
});

function claudeMessage(content: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_01', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content, stop_reason: 'end_turn', stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 },
    ...overrides,
  };
}

describe('traducción hacia Claude', () => {
  it('convierte texto, imágenes y PDF del usuario', () => {
    const messages = toAnthropicMessages([{ role: 'user', content: [
      { type: 'input_text', text: 'Lee la credencial' },
      { type: 'input_image', image_url: 'data:image/jpeg;base64,QUJD', detail: 'high' },
      { type: 'input_file', filename: 'ine.pdf', file_data: 'data:application/pdf;base64,UERG' },
    ] }]);
    expect(messages).toEqual([{ role: 'user', content: [
      { type: 'text', text: 'Lee la credencial' },
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' } },
    ] }]);
  });

  it('repite el turno original del asistente sin duplicar sus llamadas y agrupa los resultados', () => {
    const output = fromAnthropicMessage(claudeMessage([
      { type: 'thinking', thinking: '', signature: 'firma' },
      { type: 'text', text: 'Consulto el expediente.' },
      { type: 'tool_use', id: 'toolu_1', name: 'buscar_expediente', input: { q: 'Clerc' } },
    ], { stop_reason: 'tool_use' }) as never).output;
    const messages = toAnthropicMessages([
      { role: 'user', content: 'Busca el expediente de Clerc' },
      ...output,
      { type: 'function_call_output', call_id: 'toolu_1', output: '{"isError":false}' },
    ]);
    expect(messages).toHaveLength(3);
    expect(messages[1]).toEqual({ role: 'assistant', content: [
      { type: 'thinking', thinking: '', signature: 'firma' },
      { type: 'text', text: 'Consulto el expediente.' },
      { type: 'tool_use', id: 'toolu_1', name: 'buscar_expediente', input: { q: 'Clerc' } },
    ] });
    expect(messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"isError":false}' },
    ] });
  });

  it('reconstruye llamadas de historiales sin bloques originales', () => {
    const messages = toAnthropicMessages([
      { role: 'user', content: 'Hola' },
      { type: 'function_call', call_id: 'call_9', name: 'listar', arguments: '{"page":1}' },
      { type: 'function_call_output', call_id: 'call_9', output: '[]' },
      { role: 'assistant', content: 'No hay resultados.' },
    ]);
    expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(messages[1].content).toEqual([{ type: 'tool_use', id: 'call_9', name: 'listar', input: { page: 1 } }]);
  });

  it('arma la solicitud con salida estructurada, effort, caché y respaldo ante rechazos', () => {
    const schema = { type: 'object', properties: {}, additionalProperties: false };
    const request = toAnthropicRequest({
      instructions: 'Sólo datos visibles', input: [{ role: 'user', content: 'Hola' }], tools: [],
      toolChoice: 'none', responseFormat: { name: 'ine', schema }, model: 'claude-opus-5-5', maxOutputTokens: 6000,
    });
    expect(request).toMatchObject({
      model: 'claude-opus-5-5', max_tokens: 6000, system: 'Sólo datos visibles',
      output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
      cache_control: { type: 'ephemeral' }, fallbacks: 'default',
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      betas: ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'],
    });
    expect(request).not.toHaveProperty('tools');
  });

  it('nunca envía el modelo de IBM a Claude', () => {
    expect(anthropicModel('global-models')).toBe('claude-opus-5-5');
    expect(anthropicModel('claude-sonnet-5-5')).toBe('claude-sonnet-5-5');
  });
});

describe('traducción desde Claude', () => {
  it('expone texto, llamadas y consumo con la convención interna', () => {
    const response = fromAnthropicMessage(claudeMessage([
      { type: 'text', text: '{"documentKind":"INE"}' },
    ]) as never);
    expect(response.output_text).toBe('{"documentKind":"INE"}');
    expect(response.status).toBe('completed');
    expect(response.usage).toMatchObject({
      input_tokens: 160, output_tokens: 20, total_tokens: 180,
      input_tokens_details: { cached_tokens: 50 },
    });
  });

  it('marca como incompleta una respuesta cortada por max_tokens para reintentar', () => {
    const response = fromAnthropicMessage(claudeMessage([{ type: 'text', text: 'parcial' }], { stop_reason: 'max_tokens' }) as never);
    expect(response).toMatchObject({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  });
});

describe('proveedor con ASSISTANT_PROVIDER=anthropic', () => {
  it('llama a la Messages API con la clave de Tabelio y devuelve el formato interno', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(claudeMessage([
      { type: 'text', text: 'Hola, soy Tabelio IA.' },
    ])), { status: 200, headers: { 'content-type': 'application/json', 'request-id': 'req_1' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true', ASSISTANT_PROVIDER: 'anthropic', ASSISTANT_API_KEY: 'sk-ant-prueba',
      ASSISTANT_API_BASE_URL: 'https://api.anthropic.com', ASSISTANT_MODEL: 'global-models',
    }));

    const response = await service.createResponse({ instructions: 'Ayuda', input: [{ role: 'user', content: 'Hola' }], tools: [] });

    expect(response.output_text).toBe('Hola, soy Tabelio IA.');
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe('https://api.anthropic.com/v1/messages');
    const headers = new Headers(init.headers);
    // El SDK 1.x envía la clave como Bearer.
    expect(headers.get('authorization')).toBe('Bearer sk-ant-prueba');
    expect(headers.get('anthropic-beta')).toContain('server-side-fallback-2026-07-01');
    expect(JSON.parse(String(init.body))).toMatchObject({ model: 'claude-opus-5-5', system: 'Ayuda' });
  });

  it('informa el código HTTP cuando Claude rechaza la clave', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' },
    }), { status: 401, headers: { 'content-type': 'application/json' } })));
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true', ASSISTANT_PROVIDER: 'anthropic', ASSISTANT_API_KEY: 'sk-ant-invalida',
    }));
    await expect(service.createResponse({ instructions: 'Ayuda', input: [{ role: 'user', content: 'Hola' }], tools: [] }))
      .rejects.toThrow('HTTP 401');
  });
});
