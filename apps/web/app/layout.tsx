import type { Metadata, Viewport } from 'next';
import { AssistantHost } from '@/components/assistant-host';
import './globals.css';
import '@/components/administration.css';
import '@/components/mobile-shell.css';
import '@/components/assistant-mobile.css';

export const metadata: Metadata = {
  title: 'Tabelio',
  applicationName: 'Tabelio',
  description: 'Gestión contractual inmobiliaria',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#173f31',
  interactiveWidget: 'resizes-content',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <AssistantHost />
      </body>
    </html>
  );
}
