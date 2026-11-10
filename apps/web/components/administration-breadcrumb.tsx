import Link from 'next/link';

export function AdministrationBreadcrumb({ current }: { current?: string }) {
  return (
    <nav className="administration-breadcrumb" aria-label="Ubicación">
      <span>Administración</span><span aria-hidden="true">/</span>
      {current ? <><Link href="/administracion/puesta-en-marcha">Puesta en marcha</Link><span aria-hidden="true">/</span><span aria-current="page">{current}</span></>
        : <span aria-current="page">Puesta en marcha</span>}
    </nav>
  );
}
