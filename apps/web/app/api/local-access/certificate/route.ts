import { readFile } from 'node:fs/promises';
import { NextResponse } from 'next/server';
import { localCertificatePath } from '@/lib/local-tls';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Only the public CA certificate is downloadable; no path input or private key access. */
export async function GET() {
  if (process.env.NODE_ENV === 'production') return new Response(null, { status: 404 });
  try {
    const certificate = await readFile(/* turbopackIgnore: true */ localCertificatePath('Expediente-Local-CA.cer'));
    return new Response(certificate, { headers: {
      'Content-Type': 'application/x-x509-ca-cert',
      'Content-Disposition': 'attachment; filename="Expediente-Local-CA.cer"',
      'Cache-Control': 'no-store',
    } });
  } catch {
    return NextResponse.json({ message: 'El certificado local aún no está preparado.' }, { status: 404 });
  }
}
