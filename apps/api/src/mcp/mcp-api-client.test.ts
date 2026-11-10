import { ConfigService } from '@nestjs/config';
import { createServer, type Server } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { McpApiClient } from './mcp-api-client';
import type { McpOperation } from './operation-catalog';

let server: Server;
let baseUrl: string;
let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(resolve(tmpdir(), 'despacho-mcp-'));
  server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks).toString('utf8');

    if (request.url?.startsWith('/api/file')) {
      response.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': "attachment; filename*=UTF-8''contrato.pdf",
      });
      response.end('pdf-content');
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify({
      url: request.url,
      authorization: request.headers.authorization,
      contentType: request.headers['content-type'],
      bodyContainsPayload: body.includes('contenido-prueba') && body.includes('OTHER'),
    }));
  });
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No se pudo iniciar el servidor de prueba.');
  baseUrl = `http://127.0.0.1:${address.port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  await rm(temporaryDirectory, { recursive: true, force: true });
});

describe('MCP API client', () => {
  it('forwards identity, route parameters and query values', async () => {
    const client = createClient();
    const result = await client.call(operation({ apiPath: 'matters/:id', method: 'GET' }), {
      params: { id: 'matter 1' },
      query: { limit: 8 },
    }, 'individual-token');

    expect(result.isError).not.toBe(true);
    expect(result.structuredContent).toEqual({
      result: {
        url: '/api/matters/matter%201?limit=8',
        authorization: 'Bearer individual-token',
        contentType: undefined,
        bodyContainsPayload: false,
      },
    });
  });

  it('uploads a local file as multipart data', async () => {
    const source = resolve(temporaryDirectory, 'evidencia.txt');
    await writeFile(source, 'contenido-prueba');
    const client = createClient();
    const result = await client.call(operation({
      apiPath: 'matters/m1/documents',
      method: 'POST',
      acceptsFiles: true,
    }), {
      body: { type: 'OTHER' },
      files: [{ path: source, mimeType: 'text/plain' }],
    }, 'individual-token');

    expect(result.structuredContent).toMatchObject({
      result: {
        authorization: 'Bearer individual-token',
        contentType: expect.stringContaining('multipart/form-data'),
        bodyContainsPayload: true,
      },
    });
  });

  it('saves downloads without exposing binary data to the model', async () => {
    const target = resolve(temporaryDirectory, 'resultado.pdf');
    const client = createClient();
    const result = await client.call(operation({
      apiPath: 'file',
      method: 'GET',
      returnsFile: true,
    }), { outputPath: target }, 'individual-token');

    expect(result.structuredContent).toMatchObject({
      path: target,
      fileName: 'resultado.pdf',
      mimeType: 'application/pdf',
    });
    expect(await readFile(target, 'utf8')).toBe('pdf-content');
  });
});

function createClient() {
  return new McpApiClient(new ConfigService({
    MCP_INTERNAL_API_URL: baseUrl,
    MCP_OUTPUT_DIR: temporaryDirectory,
  }));
}

function operation(overrides: Partial<McpOperation>): McpOperation {
  return {
    name: 'despacho_test_operation',
    title: 'Prueba',
    description: 'Operación de prueba.',
    controllerName: 'TestController',
    handlerName: 'operation',
    method: 'GET',
    apiPath: 'test',
    permissions: [],
    inputSchema: { type: 'object' },
    acceptsFiles: false,
    multipleFiles: false,
    returnsFile: false,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
    ...overrides,
  };
}
