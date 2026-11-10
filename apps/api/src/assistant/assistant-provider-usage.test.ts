import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantProviderService } from './assistant-provider.service';

const request = { instructions: 'Prueba de consumo', input: [], tools: [] };

function fixture() {
  let index = 0;
  const usage = {
    startAttempt: vi.fn(async () => `attempt-${++index}`),
    finishAttempt: vi.fn().mockResolvedValue(undefined),
    failAttempt: vi.fn().mockResolvedValue(undefined),
  };
  const service = new AssistantProviderService(new ConfigService({
    ASSISTANT_ENABLED: 'true', ASSISTANT_API_KEY: 'test-provider-key',
    ASSISTANT_API_BASE_URL: 'https://provider.example/v1', ASSISTANT_MODEL: 'model-alias',
  }), usage as never);
  const fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  return { service, usage, fetchMock };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('registro de cada petición física al proveedor', () => {
  it('registra el primer consumo incompleto antes del reintento y usa IDs distintos para ambos', async () => {
    const { service, usage, fetchMock } = fixture();
    const incomplete = {
      id: 'response-first', model: 'effective-model', status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' }, output: [],
      usage: { input_tokens: 120, output_tokens: 40 },
    };
    const complete = {
      id: 'response-second', model: 'effective-model', status: 'completed', output: [],
      output_text: 'Respuesta final', usage: { input_tokens: 120, output_tokens: 80 },
    };
    fetchMock.mockImplementationOnce(async () => {
      expect(usage.startAttempt).toHaveBeenCalledOnce();
      return Response.json(incomplete, { headers: { 'x-request-id': 'provider-first' } });
    }).mockImplementationOnce(async () => {
      expect(usage.finishAttempt).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ payload: incomplete }));
      return Response.json(complete, { headers: { 'x-request-id': 'provider-second' } });
    });

    await expect(service.createResponse(request)).resolves.toMatchObject({ output_text: 'Respuesta final' });
    expect(usage.startAttempt.mock.calls).toEqual([['model-alias'], ['model-alias']]);
    expect(usage.finishAttempt.mock.calls.map(([id, result]) => ({ id, payload: result.payload, status: result.httpStatus }))).toEqual([
      { id: 'attempt-1', payload: incomplete, status: 200 },
      { id: 'attempt-2', payload: complete, status: 200 },
    ]);
    expect(usage.finishAttempt.mock.calls.map(([, result]) => result.responseHeaders.get('x-request-id')))
      .toEqual(['provider-first', 'provider-second']);
    expect(fetchMock.mock.calls.map(([, init]) => new Headers(init.headers).get('X-Client-Request-Id')))
      .toEqual(['attempt-1', 'attempt-2']);
    expect(usage.failAttempt).not.toHaveBeenCalled();
  });

  it.each([
    ['estructura incompatible', 200, { usage: { input_tokens: 100, output_tokens: 20 } }, 'incompatible'],
    ['fallo de proveedor', 200, { status: 'failed', error: { message: 'private detail' }, output: [], usage: { input_tokens: 100 } }, 'completar'],
    ['HTTP de error', 429, { error: { message: 'private detail' }, usage: { input_tokens: 100 } }, 'HTTP 429'],
    ['salida vacía', 200, { output: [], usage: { input_tokens: 100 } }, 'contenido'],
  ])('conserva usage aunque rechace la respuesta por %s', async (_name, status, payload, expected) => {
    const { service, usage, fetchMock } = fixture();
    fetchMock.mockResolvedValue(Response.json(payload, { status, headers: { 'x-request-id': 'failure-id' } }));
    await expect(service.createResponse(request)).rejects.toThrow(expected);
    expect(usage.finishAttempt).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ payload, httpStatus: status }));
    expect(usage.failAttempt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('registra la petición con respuesta JSON ilegible antes de devolver un error', async () => {
    const { service, usage, fetchMock } = fixture();
    fetchMock.mockResolvedValue(new Response('respuesta no JSON', { status: 200 }));
    await expect(service.createResponse(request)).rejects.toThrow('incompatible');
    expect(usage.finishAttempt).toHaveBeenCalledWith('attempt-1', expect.objectContaining({ payload: null, httpStatus: 200 }));
    expect(usage.failAttempt).not.toHaveBeenCalled();
  });

  it('deja pendiente un timeout que pudo haber sido procesado por IBM', async () => {
    vi.useFakeTimers();
    const { service, usage, fetchMock } = fixture();
    fetchMock.mockImplementation(async (_url, init: RequestInit) => new Promise((_resolve, reject) => {
      const abort = () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }));
      if (init.signal?.aborted) abort();
      else init.signal?.addEventListener('abort', abort, { once: true });
    }));
    const result = service.createResponse({ ...request, timeoutMs: 25 });
    const assertion = expect(result).rejects.toThrow('tiempo de espera');
    await vi.advanceTimersByTimeAsync(26);
    await assertion;
    expect(usage.failAttempt).toHaveBeenCalledWith('attempt-1');
    expect(usage.finishAttempt).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('no llama a IBM si falla la persistencia inicial', async () => {
    const { service, usage, fetchMock } = fixture();
    usage.startAttempt.mockRejectedValueOnce(new ServiceUnavailableException('No se pudo registrar consumo'));
    await expect(service.createResponse(request)).rejects.toThrow('registrar consumo');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(usage.finishAttempt).not.toHaveBeenCalled();
    expect(usage.failAttempt).not.toHaveBeenCalled();
  });

  it('si falla el registro del reintento, conserva el consumo inicial y evita una segunda llamada', async () => {
    const { service, usage, fetchMock } = fixture();
    usage.startAttempt.mockResolvedValueOnce('attempt-1')
      .mockRejectedValueOnce(new ServiceUnavailableException('Registro no disponible'));
    fetchMock.mockResolvedValueOnce(Response.json({
      status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' },
      output: [], usage: { input_tokens: 80, output_tokens: 30 },
    }));
    await expect(service.createResponse(request)).rejects.toThrow('Registro no disponible');
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(usage.finishAttempt).toHaveBeenCalledOnce();
    expect(usage.failAttempt).not.toHaveBeenCalled();
  });

  it('una desconexión conserva el intento pendiente sin repetir inferencias', async () => {
    const { service, usage, fetchMock } = fixture();
    fetchMock.mockRejectedValueOnce(new Error('connection reset'));
    await expect(service.createResponse(request)).rejects.toThrow('comunicarse');
    expect(usage.failAttempt).toHaveBeenCalledWith('attempt-1');
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
