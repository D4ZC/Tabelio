'use client';

import Link from 'next/link';
import { AppShell } from '@/components/app-shell';
import { AdministrationBreadcrumb } from '@/components/administration-breadcrumb';

export default function GettingStartedPage() {
  return (
    <AppShell allowedRoles={['ADMIN']}>
      <AdministrationBreadcrumb />
      <header className="page-header administration-header">
        <div><span className="eyebrow">Organiza la adopción de la plataforma</span><h1>Puesta en marcha</h1><p>Prepara a tu equipo, prueba el proceso y revisa los resultados antes de ampliar el uso.</p></div>
        <span className="administration-role">Solo administración</span>
      </header>
      <section className="administration-intro">
        <span className="administration-intro-mark" aria-hidden="true">T</span>
        <div><h2>Un buen inicio para tu despacho</h2><p>Usa este espacio al incorporar al equipo o planear una nueva etapa de adopción. La preparación, las revisiones y su historial quedan reunidos aquí.</p></div>
      </section>
      <div className="administration-setup-grid">
        <section className="administration-setup-card" aria-labelledby="initial-trial-title">
          <span className="administration-step">01 <span>Prueba con tu equipo</span></span>
          <h2 id="initial-trial-title">Prueba inicial</h2>
          <p>Empieza con un grupo pequeño y algunos expedientes para comprobar que el proceso funciona para tu despacho.</p>
          <ul><li>Revisa datos, respaldos y preparación.</li><li>Registra participantes y capacitación.</li><li>Compara resultados y da seguimiento a incidencias.</li></ul>
          <div className="administration-card-actions"><Link className="button primary" href="/piloto">Preparar prueba <span aria-hidden="true">→</span></Link><Link className="administration-secondary-link" href="/piloto/operacion">Gestionar participantes y seguimiento</Link></div>
        </section>
        <section className="administration-setup-card" aria-labelledby="approval-title">
          <span className="administration-step">02 <span>Revisa y decide</span></span>
          <h2 id="approval-title">Revisión y aprobación</h2>
          <p>Reúne las comprobaciones y la evidencia para decidir cuándo tu equipo está listo para ampliar el uso.</p>
          <ul><li>Comprueba el funcionamiento y las integraciones.</li><li>Revisa los controles y resultados de la prueba.</li><li>Registra la aprobación o los ajustes pendientes.</li></ul>
          <div className="administration-card-actions"><Link className="button primary" href="/lanzamiento">Revisar y aprobar <span aria-hidden="true">→</span></Link><small>La aprobación queda registrada con su evidencia.</small></div>
        </section>
      </div>
      <div className="administration-return"><span>Para continuar con el trabajo de hoy</span><Link href="/asistente">Ir a Tabelio IA <span aria-hidden="true">↗</span></Link></div>
    </AppShell>
  );
}
