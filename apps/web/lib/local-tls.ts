import { readFile } from 'node:fs/promises';
import { request } from 'node:https';
import path from 'node:path';

export function localCertificatePath(fileName: 'rootCA.pem' | 'Expediente-Local-CA.cer') {
  return path.resolve(/* turbopackIgnore: true */ process.cwd(), process.env.LOCAL_CERTIFICATE_DIR || '../../.certificates', fileName);
}

export async function activeLocalHttps() {
  if (process.env.NODE_ENV === 'production') return undefined;
  try {
    const ca = await readFile(/* turbopackIgnore: true */ localCertificatePath('rootCA.pem'));
    const port = Number(process.env.LOCAL_HTTPS_PORT || 3443);
    return await new Promise<{ httpsPort: number; webPort: number } | undefined>((resolve) => {
      const probe = request({ hostname: '127.0.0.1', port, path: '/_local-https/health', ca, timeout: 800 }, (response) => {
        let body = '';
        response.on('data', (chunk) => { body += chunk; if (body.length > 1000) probe.destroy(); });
        response.on('end', () => {
          try {
            const health = JSON.parse(body) as { service?: string; httpsPort?: number; webPort?: number };
            resolve(health.service === 'despacho-local-https' && health.httpsPort === port && typeof health.webPort === 'number'
              ? { httpsPort: port, webPort: health.webPort } : undefined);
          } catch { resolve(undefined); }
        });
        response.on('error', () => resolve(undefined));
      });
      probe.on('timeout', () => probe.destroy());
      probe.on('error', () => resolve(undefined));
      probe.end();
    });
  } catch { return undefined; }
}
