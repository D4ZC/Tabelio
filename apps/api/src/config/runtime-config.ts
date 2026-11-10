const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

export function validateRuntimeConfig(raw: Record<string, unknown>) {
  const config = { ...raw } as Record<string, string | undefined>;
  const jwtSecret = config.JWT_SECRET ?? '';
  if (jwtSecret.length < 32) throw new Error('JWT_SECRET debe tener al menos 32 caracteres');

  const databaseUrl = config.DATABASE_URL ?? '';
  if (!databaseUrl.startsWith('postgresql://') && !databaseUrl.startsWith('postgres://')) {
    throw new Error('DATABASE_URL debe usar PostgreSQL');
  }

  const origins = parseWebOrigins(config.WEB_ORIGIN ?? 'http://localhost:3000');
  const productionRemoteOrigins = origins.filter((origin) => {
    const url = new URL(origin);
    return !LOCAL_HOSTS.has(url.hostname);
  });
  if (config.NODE_ENV === 'production' && productionRemoteOrigins.some((origin) => !origin.startsWith('https://'))) {
    throw new Error('WEB_ORIGIN debe usar HTTPS fuera de localhost en producción');
  }
  if (
    config.NODE_ENV === 'production'
    && productionRemoteOrigins.length > 0
    && /(replace|change|example|demo|local)/i.test(jwtSecret)
  ) {
    throw new Error('JWT_SECRET debe ser un secreto aleatorio y no un valor de ejemplo');
  }
  if (config.NODE_ENV === 'production' && productionRemoteOrigins.length > 0 && config.COOKIE_SECURE !== 'true') {
    throw new Error('COOKIE_SECURE debe ser true en producción fuera de localhost');
  }
  if (
    config.NODE_ENV === 'production'
    && productionRemoteOrigins.length > 0
    && (config.PASSWORD_RECOVERY_DRIVER ?? 'local') === 'local'
  ) {
    throw new Error('PASSWORD_RECOVERY_DRIVER=local no está permitido en producción remota');
  }

  if ((config.STORAGE_DRIVER ?? 'local') === 's3') {
    for (const key of ['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET']) {
      if (!config[key]?.trim()) throw new Error(`${key} es obligatorio cuando STORAGE_DRIVER=s3`);
    }
  }
  validateProductionAssistantConfig(config);
  return raw;
}

function validateProductionAssistantConfig(config: Record<string, string | undefined>) {
  const enabled = (config.ASSISTANT_ENABLED ?? 'false') === 'true';
  if (config.NODE_ENV !== 'production' || !enabled) return;

  const apiKey = config.ASSISTANT_API_KEY?.trim() ?? '';
  if (!apiKey) throw new Error('ASSISTANT_API_KEY es obligatoria cuando el asistente está habilitado en producción');
  if (/(change[_-]?me|replace|example|placeholder)/i.test(apiKey)) {
    throw new Error('ASSISTANT_API_KEY no puede conservar un valor de ejemplo en producción');
  }

  const rawBaseUrl = config.ASSISTANT_API_BASE_URL?.trim() ?? '';
  if (!rawBaseUrl) {
    throw new Error('ASSISTANT_API_BASE_URL es obligatoria cuando el asistente está habilitado en producción');
  }
  const providerUrl = parseHttpUrl(rawBaseUrl, 'ASSISTANT_API_BASE_URL');
  const providerIsLoopback = LOCAL_HOSTS.has(providerUrl.hostname);
  if (providerUrl.protocol !== 'https:' && !(providerUrl.protocol === 'http:' && providerIsLoopback)) {
    throw new Error('ASSISTANT_API_BASE_URL debe usar HTTPS fuera de localhost');
  }
  if (providerUrl.username || providerUrl.password) {
    throw new Error('ASSISTANT_API_BASE_URL no debe contener credenciales');
  }

  const model = config.ASSISTANT_MODEL?.trim() ?? '';
  if (!model || /(change[_-]?me|replace|example|placeholder)/i.test(model)) {
    throw new Error('ASSISTANT_MODEL debe identificar un modelo permitido por el proveedor');
  }

  const header = (config.ASSISTANT_API_KEY_HEADER ?? 'Authorization').trim();
  const scheme = (config.ASSISTANT_API_KEY_SCHEME ?? 'Bearer').trim();
  if (!/^[A-Za-z0-9-]+$/.test(header) || /[\r\n]/.test(scheme)) {
    throw new Error('La configuración del encabezado de autenticación del asistente no es válida');
  }

  if (config.ASSISTANT_MCP_URL?.trim()) {
    const mcpUrl = parseHttpUrl(config.ASSISTANT_MCP_URL, 'ASSISTANT_MCP_URL');
    if (!['http:', 'https:'].includes(mcpUrl.protocol) || !LOCAL_HOSTS.has(mcpUrl.hostname)) {
      throw new Error('ASSISTANT_MCP_URL debe usar HTTP o HTTPS sobre loopback');
    }
  }

  for (const key of [
    'ASSISTANT_MCP_TIMEOUT_MS',
    'ASSISTANT_TURN_TIMEOUT_MS',
    'ASSISTANT_TIMEOUT_MS',
    'ASSISTANT_MAX_OUTPUT_TOKENS',
    'ASSISTANT_MAX_TOOL_ROUNDS',
    'ASSISTANT_MAX_TOOL_CALLS_PER_RESPONSE',
    'ASSISTANT_MAX_TOOL_CALLS_PER_TURN',
    'ASSISTANT_MAX_PENDING_ACTIONS_PER_USER',
    'ASSISTANT_RATE_LIMIT_PER_MINUTE',
  ]) {
    const rawValue = config[key]?.trim();
    if (!rawValue) continue;
    const value = Number(rawValue);
    if (!Number.isInteger(value) || value <= 0) throw new Error(`${key} debe ser un entero positivo`);
  }
}

function parseHttpUrl(raw: string, name: string) {
  try {
    return new URL(raw);
  } catch {
    throw new Error(`${name} no es una URL válida`);
  }
}

export function parseWebOrigins(raw: string) {
  const origins = raw.split(',').map((origin) => origin.trim()).filter(Boolean);
  if (origins.length === 0) throw new Error('WEB_ORIGIN debe contener al menos un origen');
  for (const origin of origins) {
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/' || url.search || url.hash) {
      throw new Error(`WEB_ORIGIN inválido: ${origin}`);
    }
  }
  return origins;
}
