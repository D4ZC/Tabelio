import { networkInterfaces } from 'node:os';
import QRCode from 'qrcode';
import { NextRequest, NextResponse } from 'next/server';
import { apiProxyTarget } from '@/lib/api-endpoint';
import { localAccessUrls } from '@/lib/local-access';
import { activeLocalHttps } from '@/lib/local-tls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' };
  try {
    const target = apiProxyTarget(process.env.API_PROXY_TARGET ?? process.env.NEXT_PUBLIC_API_URL);
    const identity = await fetch(`${target}/auth/me`, {
      headers: { cookie: request.headers.get('cookie') ?? '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (!identity.ok) return NextResponse.json({ message: 'Inicia sesión para conectar tu teléfono.' }, { status: identity.status === 401 ? 401 : 503, headers });

    // Next dev can normalize the URL to localhost; the Host header retains the actual port.
    const origin = new URL(request.url);
    const host = request.headers.get('host');
    if (host) origin.host = host;
    const scheme = request.headers.get('x-forwarded-proto');
    if (scheme === 'https' || scheme === 'http') origin.protocol = `${scheme}:`;
    const localHttps = await activeLocalHttps();
    if (localHttps) { origin.protocol = 'https:'; origin.port = String(localHttps.httpsPort); }
    const urls = localAccessUrls(networkInterfaces(), origin.origin);
    const qrOptions = {
        width: 296, margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#183c32', light: '#ffffff' },
    } as const;
    const connections = await Promise.all(urls.map(async (url) => {
      const certificateUrl = new URL('/api/local-access/certificate', url);
      certificateUrl.protocol = 'http:';
      certificateUrl.port = String(localHttps?.webPort ?? 3000);
      return {
        url, qrDataUrl: await QRCode.toDataURL(url, qrOptions),
        ...(localHttps ? { certificateUrl: certificateUrl.toString(), certificateQrDataUrl: await QRCode.toDataURL(certificateUrl.toString(), qrOptions) } : {}),
      };
    }));
    return NextResponse.json({ connections }, { headers });
  } catch {
    return NextResponse.json({ message: 'No pudimos preparar el acceso local. Comprueba que la API esté encendida.' }, { status: 503, headers });
  }
}
