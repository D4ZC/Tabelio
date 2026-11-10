'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { apiFetch, clearSession } from '@/lib/api';
import { MobileAccess } from './mobile-access';

const links = [
  { href: '/buscar', label: 'Buscar', icon: 'search' },
  { href: '/asistente', label: 'Tabelio IA', icon: 'spark' },
  { href: '/expedientes', label: 'Expedientes', icon: 'folder' },
  { href: '/documentos', label: 'Documentos', icon: 'document' },
  { href: '/biblioteca', label: 'Biblioteca jurídica', icon: 'document' },
  { href: '/extracciones', label: 'Extracciones', icon: 'scan', roles: ['ADMIN', 'LAWYER', 'OPERATOR'] },
  { href: '/tareas', label: 'Tareas', icon: 'check' },
  { href: '/avisos', label: 'Avisos', icon: 'bell' },
  { href: '/reportes', label: 'Reportes', icon: 'chart' },
  { href: '/auditoria', label: 'Auditoría', icon: 'scan', roles: ['ADMIN'] },
  { href: '/directorio', label: 'Directorio', icon: 'users' },
  { href: '/requisitos', label: 'Requisitos', icon: 'check', roles: ['ADMIN', 'LAWYER'] },
  { href: '/clausulas', label: 'Cláusulas', icon: 'document', roles: ['ADMIN', 'LAWYER'] },
  { href: '/equipo', label: 'Equipo', icon: 'users', roles: ['ADMIN', 'LAWYER'] },
  { href: '/administracion/puesta-en-marcha', label: 'Administración', icon: 'settings', roles: ['ADMIN'] },
  { href: '/cuenta', label: 'Mi cuenta', icon: 'user' },
];

function isNavigationLinkActive(pathname: string, href: string) {
  if (href === '/administracion/puesta-en-marcha') {
    return ['/administracion', '/piloto', '/lanzamiento'].some((base) => pathname === base || pathname.startsWith(`${base}/`));
  }
  return pathname.startsWith(href);
}

const mobileLinks = [
  { href: '/expedientes', label: 'Expedientes', icon: 'folder' },
  { href: '/tareas', label: 'Tareas', icon: 'check' },
  { href: '/asistente', label: 'Tabelio IA', icon: 'spark' },
  { href: '/documentos', label: 'Documentos', icon: 'document' },
];

function ShellIcon({ name }: { name: string }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
    spark: <><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z" /><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6L20 2Z" /></>,
    folder: <path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7Z" />,
    document: <><path d="M14 3H5v18h14V8l-5-5Z" /><path d="M14 3v5h5M8 12h8M8 16h6" /></>,
    check: <><rect x="3" y="3" width="18" height="18" rx="5" /><path d="m7 12 3 3 7-7" /></>,
    bell: <><path d="M5 10a7 7 0 0 1 14 0c0 6 2 6 2 7H3c0-1 2-1 2-7ZM10 21h4" /></>,
    chart: <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16v-8" /></>,
    settings: <><path d="M4 7h16M4 17h16M8 4v6M16 14v6" /><circle cx="8" cy="7" r="2" fill="var(--forest)" /><circle cx="16" cy="17" r="2" fill="var(--forest)" /></>,
    scan: <><path d="M3 8V3h5M16 3h5v5M21 16v5h-5M8 21H3v-5M7 12h10M9 8h6M9 16h6" /></>,
    users: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-4a6 6 0 0 1 12 0v4M17 4a3 3 0 0 1 0 6M18 13a5 5 0 0 1 3 4v4" /></>,
    user: <><circle cx="12" cy="7" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    logout: <><path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.spark}</svg>;
}

export function AppShell({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: readonly string[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [user, setUser] = useState<{ id: string; displayName?: string; role?: string; organization?: { name?: string } }>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let active = true;
    apiFetch<{ id: string; displayName: string; role: string; organization: { name: string } }>('/auth/me')
      .then((identity) => {
        if (!active) return;
        setUser(identity);
        setReady(true);
      })
      .catch(() => { if (active) setLoadError(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => { setMenuOpen(false); }, [pathname]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !ready) return;
    if (!menuOpen) {
      if (dialog.open) dialog.close();
      return;
    }
    dialog.showModal();
    closeButtonRef.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const viewport = window.matchMedia('(max-width: 760px)');
    const closeOnDesktop = () => { if (!viewport.matches) setMenuOpen(false); };
    viewport.addEventListener('change', closeOnDesktop);
    return () => {
      document.body.style.overflow = previousOverflow;
      viewport.removeEventListener('change', closeOnDesktop);
      if (dialog.open) dialog.close();
    };
  }, [menuOpen, ready]);

  function closeMenu() {
    setMenuOpen(false);
    menuButtonRef.current?.focus();
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = String(new FormData(event.currentTarget).get('q') ?? '').trim();
    if (query.length >= 2) {
      setMenuOpen(false);
      router.push(`/buscar?q=${encodeURIComponent(query)}`);
    }
  }

  if (!ready) return (
    <div className="page-loader shell-loader" role="status">
      <span className="shell-loader-mark">T</span>
      <span>{loadError ? 'No se pudo conectar con tu despacho.' : 'Preparando tu espacio…'}</span>
      {loadError && <button className="button secondary" onClick={() => location.reload()}>Volver a intentar</button>}
    </div>
  );

  const visibleLinks = links.filter((link) => !link.roles || link.roles.includes(user?.role ?? ''));
  const initials = user?.displayName?.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('') ?? 'U';
  const moreActive = !mobileLinks.some((link) => pathname.startsWith(link.href));

  const sidebarContent = (mobile = false) => <>
    {!mobile && <Link href="/asistente" className="brand" aria-label="Tabelio, ir a Tabelio IA"><span className="brand-mark">T</span><div><strong>Tabelio</strong><small>Legal inmobiliario</small></div></Link>}
    <form className="sidebar-search" onSubmit={search}>
      <input aria-label={mobile ? 'Buscar desde el menú' : 'Buscar en la plataforma'} name="q" minLength={2} maxLength={100} required placeholder="Buscar expediente, persona…" />
      <button aria-label="Buscar"><ShellIcon name="search" /></button>
    </form>
    <nav aria-label={mobile ? 'Todas las secciones' : 'Navegación principal'}>
      {visibleLinks.map((link) => (
        <Link className={isNavigationLinkActive(pathname, link.href) ? 'active' : ''} href={link.href} key={link.href} aria-current={isNavigationLinkActive(pathname, link.href) ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
          <span><ShellIcon name={link.icon} /></span>{link.label}
        </Link>
      ))}
    </nav>
    <MobileAccess />
    <Link href="/tutorial" className={`sidebar-tutorial-link${pathname === '/tutorial' ? ' active' : ''}`} aria-current={pathname === '/tutorial' ? 'page' : undefined} onClick={() => setMenuOpen(false)}>
      <span aria-hidden="true">▷</span><div><strong>Aprender a usar la app</strong><small>Tutorial y práctica guiada</small></div>
    </Link>
    <div className="sidebar-user">
      <Link href="/cuenta" className="avatar" aria-label="Mi cuenta" onClick={() => setMenuOpen(false)}>{initials}</Link>
      <div><strong>{user?.displayName ?? 'Usuario'}</strong><small>{user?.organization?.name ?? ''}</small></div>
      <button aria-label="Cerrar sesión" onClick={() => void clearSession()}><ShellIcon name="logout" /></button>
    </div>
  </>;

  return (
    <div className={`app-frame${pathname === '/asistente' ? ' app-frame-assistant' : ''}`}>
      <aside className="sidebar desktop-sidebar">{sidebarContent()}</aside>
      <header className="mobile-topbar">
        <Link href="/asistente" className="mobile-brand" aria-label="Tabelio, ir a Tabelio IA">
          <span className="mobile-brand-mark">T</span><span><strong>Tabelio</strong><small>Tu despacho, contigo</small></span>
        </Link>
        <div className="mobile-topbar-actions">
          <Link href="/buscar" className="mobile-icon-button" aria-label="Buscar en la plataforma"><ShellIcon name="search" /></Link>
          <button className="mobile-profile-button" aria-label={`Abrir menú de ${user?.displayName ?? 'usuario'}`} aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen(true)}>{initials}</button>
        </div>
      </header>
      <main className="main-content">{!allowedRoles || allowedRoles.includes(user?.role ?? '') ? children : (
        <section className="administration-access-denied" aria-labelledby="administration-access-title">
          <span className="eyebrow">Administración</span>
          <h1 id="administration-access-title">Acceso reservado al administrador</h1>
          <p>La puesta en marcha la gestiona la persona responsable de implementar la plataforma en tu despacho.</p>
          <Link href="/asistente" className="button primary">Ir a Tabelio IA</Link>
        </section>
      )}</main>
      <nav className="mobile-bottom-nav" aria-label="Accesos principales">
        {mobileLinks.map((link) => <Link key={link.href} href={link.href} className={`mobile-nav-item${link.href === '/asistente' ? ' mobile-nav-assistant' : ''}${pathname.startsWith(link.href) ? ' active' : ''}`} aria-current={pathname.startsWith(link.href) ? 'page' : undefined}>
          <span className="mobile-nav-icon"><ShellIcon name={link.icon} /></span><span>{link.label}</span>
        </Link>)}
        <button ref={menuButtonRef} className={`mobile-nav-item${menuOpen || moreActive ? ' active' : ''}`} aria-label="Más secciones" aria-haspopup="dialog" aria-expanded={menuOpen} aria-controls="mobile-menu" onClick={() => setMenuOpen(true)}><span className="mobile-nav-icon"><ShellIcon name="more" /></span><span>Más</span></button>
      </nav>
      <dialog ref={dialogRef} id="mobile-menu" className="mobile-menu-dialog" aria-labelledby="mobile-menu-title" onKeyDown={(event) => { if (event.key === 'Escape' && !dialogRef.current?.querySelector('.mobile-access-backdrop')) event.stopPropagation(); }} onCancel={(event) => { if (dialogRef.current?.querySelector('.mobile-access-backdrop')) event.preventDefault(); else setMenuOpen(false); }} onClose={() => setMenuOpen(false)} onClick={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
        <div className="mobile-menu-panel">
          <div className="mobile-menu-heading"><div><span>Tu espacio de trabajo</span><h2 id="mobile-menu-title">Todo tu despacho</h2></div><button ref={closeButtonRef} className="mobile-icon-button" aria-label="Cerrar menú" onClick={closeMenu}><ShellIcon name="close" /></button></div>
          <div className="mobile-menu-sidebar sidebar">{sidebarContent(true)}</div>
        </div>
      </dialog>
    </div>
  );
}
