import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Portal seguro · Tabelio',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export default function PortalLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
