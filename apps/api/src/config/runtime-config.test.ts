import { describe, expect, it } from 'vitest';
import { parseWebOrigins, validateRuntimeConfig } from './runtime-config';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: '12345678901234567890123456789012',
  WEB_ORIGIN: 'http://localhost:3000',
};

describe('configuración de runtime', () => {
  it('acepta desarrollo local y múltiples orígenes explícitos', () => {
    expect(validateRuntimeConfig({ ...base, WEB_ORIGIN: 'http://localhost:3000, http://127.0.0.1:3000' })).toBeTruthy();
    expect(parseWebOrigins('http://localhost:3000,https://app.example.test')).toHaveLength(2);
  });

  it('rechaza secretos cortos y producción remota insegura', () => {
    expect(() => validateRuntimeConfig({ ...base, JWT_SECRET: 'corto' })).toThrow(/32 caracteres/);
    expect(() => validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'http://app.example.test',
      COOKIE_SECURE: 'false',
    })).toThrow(/HTTPS/);
    expect(() => validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      WEB_ORIGIN: 'https://app.example.test',
      COOKIE_SECURE: 'true',
      PASSWORD_RECOVERY_DRIVER: 'email',
      JWT_SECRET: 'replace-this-example-secret-123456789',
    })).toThrow(/aleatorio/);
  });

  it('exige configuración completa del adaptador S3', () => {
    expect(() => validateRuntimeConfig({ ...base, STORAGE_DRIVER: 's3' })).toThrow(/S3_ENDPOINT/);
  });

  it('no exige proveedor del asistente durante build, desarrollo o cuando está deshabilitado', () => {
    expect(validateRuntimeConfig({ ...base, NODE_ENV: 'development' })).toBeTruthy();
    expect(validateRuntimeConfig({ ...base, NODE_ENV: 'production' })).toBeTruthy();
    expect(validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'false',
    })).toBeTruthy();
  });

  it('exige URL, credencial y modelo reales para el asistente habilitado en producción', () => {
    expect(() => validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example',
      ASSISTANT_MODEL: 'allowed-model',
    })).toThrow(/ASSISTANT_API_KEY/);
    expect(() => validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example',
      ASSISTANT_API_KEY: 'CHANGE_ME_ASSISTANT_API_KEY',
      ASSISTANT_MODEL: 'allowed-model',
    })).toThrow(/valor de ejemplo/);
    expect(() => validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'http://provider.example',
      ASSISTANT_API_KEY: 'runtime-secret',
      ASSISTANT_MODEL: 'allowed-model',
    })).toThrow(/HTTPS/);

    expect(validateRuntimeConfig({
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example/v1',
      ASSISTANT_API_KEY: 'runtime-secret',
      ASSISTANT_MODEL: 'allowed-model',
      ASSISTANT_MCP_URL: 'http://127.0.0.1:4000/mcp',
      ASSISTANT_TIMEOUT_MS: '45000',
    })).toBeTruthy();
  });

  it('rechaza límites o MCP remotos inválidos del asistente en producción', () => {
    const assistant = {
      ...base,
      NODE_ENV: 'production',
      ASSISTANT_ENABLED: 'true',
      ASSISTANT_API_BASE_URL: 'https://provider.example',
      ASSISTANT_API_KEY: 'runtime-secret',
      ASSISTANT_MODEL: 'allowed-model',
    };
    expect(() => validateRuntimeConfig({
      ...assistant,
      ASSISTANT_MCP_URL: 'https://mcp.example',
    })).toThrow(/loopback/);
    expect(() => validateRuntimeConfig({
      ...assistant,
      ASSISTANT_MAX_TOOL_ROUNDS: '0',
    })).toThrow(/entero positivo/);
  });
});
