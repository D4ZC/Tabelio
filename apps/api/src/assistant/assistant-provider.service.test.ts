import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantProviderService } from './assistant-provider.service';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('proveedor del asistente', () => {
  it('envía el esquema estricto de extracción sin activar herramientas', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      output: [{ type: 'message', content: [{ type: 'output_text', text: '{"documentKind":"INE"}' }] }],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true', ASSISTANT_API_KEY: 'clave-de-prueba',
    }));
    const schema = { type: 'object', properties: { documentKind: { type: 'string' } }, required: ['documentKind'], additionalProperties: false };
    await service.createResponse({
      instructions: 'Transcribe sólo datos visibles.', input: [], tools: [], toolChoice: 'none',
      responseFormat: { name: 'ine_fields', schema },
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body).toMatchObject({
      text: { format: { type: 'json_schema', name: 'ine_fields', schema, strict: true } },
      tools: [], tool_choice: 'none', store: false,
    });
  });

  it('permanece deshabilitado hasta que la activación sea explícita', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_API_KEY: 'private-test-key',
    }));

    await expect(service.createResponse({
      instructions: 'Ayuda',
      input: [{ role: 'user', content: 'Hola' }],
      tools: [],
    })).rejects.toThrow('Tabelio IA está deshabilitado.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('usa Responses API con la credencial sólo en el header del servidor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'response-1',
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Hola' }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example/v1',
      ASSISTANT_API_KEY: 'private-test-key',
      ASSISTANT_MODEL: 'test-model',
    }));

    const result = await service.createResponse({
      instructions: 'Ayuda',
      input: [{ role: 'user', content: 'Hola' }],
      tools: [],
    });

    expect(result.id).toBe('response-1');
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://provider.example/v1/responses');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer private-test-key');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({
      model: 'test-model',
      max_output_tokens: 6000,
      store: false,
      include: ['reasoning.encrypted_content'],
    });
    expect(body).not.toHaveProperty('tool_choice');
    expect(String(init.body)).not.toContain('private-test-key');
  });

  it('conserva los campos opcionales y reintenta una respuesta agotada sin usar su salida parcial', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [{ type: 'function_call', name: 'create', arguments: '{"body":' }],
      }))
      .mockResolvedValueOnce(Response.json({
        status: 'completed',
        output: [{ type: 'function_call', name: 'create', arguments: '{"body":{"title":"Diego IA","kind":"LEASE"}}' }],
      }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_KEY: 'test-key',
      ASSISTANT_MAX_OUTPUT_TOKENS: '1200',
    }));
    const input = [{ role: 'user', content: 'Crea un expediente Diego IA' }];
    const result = await service.createResponse({
      instructions: 'Ayuda', input,
      tools: [{ type: 'function', name: 'create', description: 'Crear', parameters: { type: 'object' } }],
    });

    expect(result.status).toBe('completed');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const bodies = fetchMock.mock.calls.map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies.map((body) => body.max_output_tokens)).toEqual([1200, 2400]);
    for (const body of bodies) {
      expect(body.input).toEqual(input);
      expect(body.tools[0].strict).toBe(false);
    }
    expect(fetchMock.mock.calls[0][1].signal).toBe(fetchMock.mock.calls[1][1].signal);
  });

  it.each(['max_output_tokens', 'content_filter'])('limita los reintentos de respuestas incompletas: %s', async (reason) => {
    const fetchMock = vi.fn().mockImplementation(async () => Response.json({
      status: 'incomplete', incomplete_details: { reason }, output: [],
    }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true', ASSISTANT_API_KEY: 'test-key',
    }));
    await expect(service.createResponse({ instructions: 'Ayuda', input: [], tools: [] }))
      .rejects.toThrow('respuesta incompleta');
    expect(fetchMock).toHaveBeenCalledTimes(reason === 'max_output_tokens' ? 2 : 1);
  });

  it('desactiva las herramientas explícitamente al solicitar una síntesis final', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      output: [{
        type: 'message',
        content: [{ type: 'output_text', text: 'Estos son los expedientes consultados.' }],
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example/v1',
      ASSISTANT_API_KEY: 'private-test-key',
    }));

    await service.createResponse({
      instructions: 'Resume los datos consultados.',
      input: [{ role: 'user', content: 'Dame detalles de los primeros expedientes.' }],
      tools: [],
      toolChoice: 'none',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      tools: [],
      tool_choice: 'none',
    });
  });

  it('no reenvía al cliente los detalles de error controlados por el proveedor', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'La solicitud contenía provider-sensitive-detail' },
    }), { status: 400, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const service = new AssistantProviderService(new ConfigService({
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example/v1',
      ASSISTANT_API_KEY: 'private-test-key',
      ASSISTANT_MODEL: 'test-model',
    }));

    await expect(service.createResponse({
      instructions: 'Ayuda',
      input: [{ role: 'user', content: 'Hola' }],
      tools: [],
    })).rejects.toThrow('El proveedor de IA rechazó la solicitud (HTTP 400).');
    await expect(service.createResponse({
      instructions: 'Ayuda',
      input: [{ role: 'user', content: 'Hola' }],
      tools: [],
    })).rejects.not.toThrow(/provider-sensitive-detail/);
  });
});
