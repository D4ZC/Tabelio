'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { chaptersForRole, type TutorialChapter, type TutorialRole } from '@/lib/tutorial-catalog';
import {
  initialTutorialProgress, markTutorialStep, moveTutorialPosition, parseTutorialProgress,
  tutorialPosition, tutorialStorageKey, type TutorialMode, type TutorialProgress,
} from '@/lib/tutorial-progress';
import { TutorialPlayer } from './tutorial-player';
import { TutorialWorkspace } from './tutorial-workspace';
import './tutorial-course.css';

interface TutorialIdentity { id: string; role: TutorialRole; organization: { id: string } }
interface TutorialAccount { key: string; chapters: TutorialChapter[]; role: TutorialRole }
const roleLabels: Record<TutorialRole, string> = { ADMIN: 'Administración', LAWYER: 'Jurídico', OPERATOR: 'Operación', VIEWER: 'Consulta' };

function minutes(seconds: number) { return Math.max(1, Math.ceil(seconds / 60)); }

export function TutorialCourse() {
  const [account, setAccount] = useState<TutorialAccount>();
  const [progress, setProgress] = useState<TutorialProgress>();
  const [active, setActive] = useState(false);
  const [paused, setPaused] = useState(true);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [actionCompleted, setActionCompleted] = useState(false);
  const [storageAvailable, setStorageAvailable] = useState(true);
  const [error, setError] = useState('');
  const [loadRevision, setLoadRevision] = useState(0);
  const [visit, setVisit] = useState(0);
  const [focusHeadingOnMount, setFocusHeadingOnMount] = useState(false);
  const sandboxRef = useRef<HTMLDivElement>(null);
  const currentStepRef = useRef('');

  useEffect(() => {
    let current = true;
    void apiFetch<TutorialIdentity>('/auth/me').then((identity) => {
      if (!current) return;
      const chapters = chaptersForRole(identity.role);
      const key = tutorialStorageKey(identity.organization.id, identity.id, identity.role);
      let raw: string | null = null;
      try { raw = localStorage.getItem(key); } catch { setStorageAvailable(false); }
      setAccount({ chapters, key, role: identity.role });
      setProgress(parseTutorialProgress(raw, chapters));
      setError('');
    }).catch(() => { if (current) setError('No se pudo preparar tu recorrido. Vuelve a intentarlo.'); });
    return () => { current = false; };
  }, [loadRevision]);

  useEffect(() => {
    if (!account || !progress) return;
    try { localStorage.setItem(account.key, JSON.stringify(progress)); }
    catch { setStorageAvailable(false); }
  }, [account, progress]);

  const chapters = account?.chapters ?? [];
  const position = progress ? tutorialPosition(chapters, progress) : { chapterIndex: 0, stepIndex: 0 };
  const chapter = chapters[position.chapterIndex];
  const step = chapter?.steps[position.stepIndex];
  currentStepRef.current = active && !progress?.finished ? step?.id ?? '' : '';
  const total = chapters.reduce((sum, item) => sum + item.steps.length, 0);
  const completed = progress?.completedStepIds.length ?? 0;
  const skipped = progress?.skippedStepIds.length ?? 0;
  const visited = completed + skipped;
  const duration = chapters.reduce((sum, item) => sum + item.steps.reduce((value, itemStep) => value + itemStep.durationSeconds, 0), 0);
  const hasProgress = Boolean(progress && (visited > 0 || position.chapterIndex > 0 || position.stepIndex > 0));

  function exit() { setPaused(true); setAudioEnabled(false); setActive(false); setActionCompleted(false); }

  function start(mode: TutorialMode, resume: boolean, chapterId?: string) {
    if (!progress || !chapters.length) return;
    const selected = chapters.find((item) => item.id === chapterId);
    setProgress((current) => {
      const next = resume && current ? { ...current, mode, finished: false } : initialTutorialProgress(chapters, mode);
      return selected ? { ...next, chapterId: selected.id, stepId: selected.steps[0].id } : next;
    });
    setActionCompleted(false);
    setFocusHeadingOnMount(true);
    setVisit((current) => current + 1);
    setPaused(false);
    setActive(true);
  }

  function goTo(chapterIndex: number, stepIndex: number) {
    const nextChapter = chapters[chapterIndex];
    if (!nextChapter?.steps[stepIndex]) return;
    setProgress((current) => current ? { ...current, chapterId: nextChapter.id, stepId: nextChapter.steps[stepIndex].id, finished: false } : current);
    setActionCompleted(false);
    setVisit((current) => current + 1);
  }

  function advance(outcome: 'completed' | 'skipped') {
    if (!progress || !step || currentStepRef.current !== step.id || (outcome === 'completed' && !actionCompleted)) return;
    const next = moveTutorialPosition(chapters, position.chapterIndex, position.stepIndex, 1);
    setProgress((current) => {
      if (!current) return current;
      const updated = markTutorialStep(current, step.id, outcome);
      return next ? { ...updated, chapterId: chapters[next.chapterIndex].id, stepId: chapters[next.chapterIndex].steps[next.stepIndex].id }
        : { ...updated, finished: true };
    });
    setActionCompleted(false);
    setVisit((current) => current + 1);
    if (!next) { setPaused(true); setAudioEnabled(false); }
  }

  function skipChapter() {
    if (!chapter || !progress || currentStepRef.current !== step?.id) return;
    const next = chapters[position.chapterIndex + 1];
    setProgress((current) => {
      if (!current) return current;
      const marked = chapter.steps.slice(position.stepIndex).reduce((value, item) => markTutorialStep(value, item.id, 'skipped'), current);
      return next ? { ...marked, chapterId: next.id, stepId: next.steps[0].id }
        : { ...marked, finished: true };
    });
    setActionCompleted(false);
    setVisit((current) => current + 1);
    if (!next) { setPaused(true); setAudioEnabled(false); }
  }

  function action(id: string) {
    if (!currentStepRef.current || currentStepRef.current !== id) return;
    setActionCompleted(true);
    setProgress((current) => current ? markTutorialStep(current, id, 'completed') : current);
  }

  if (error) return <section className="card tutorial-load-error" role="alert"><h1>Tutorial de la aplicación</h1><p>{error}</p><button type="button" className="button primary" onClick={() => setLoadRevision((current) => current + 1)}>Reintentar</button></section>;
  if (!account || !progress || !chapter || !step) return <div className="page-loader">Preparando tu tutorial…</div>;

  return <div className={`tutorial-course${active ? ' tutorial-course-active' : ''}`}>
    <header className="tutorial-course-header">
      <div><span className="eyebrow">Aprende a tu ritmo</span><h1>{active ? 'Tu recorrido guiado' : 'Conoce Tabelio'}</h1><p>{active ? `${chapter.title} · ${progress.mode === 'demo' ? 'Demostración automática' : 'Práctica guiada'}` : 'Mira cómo funciona cada herramienta y practica con un expediente de ejemplo.'}</p></div>
      {active ? <button type="button" className="button secondary" onClick={exit}>Volver al índice</button> : <Link href="/expedientes" className="text-link">Ir a la aplicación ↗</Link>}
    </header>

    {active && !progress.finished ? <>
      <div className="tutorial-course-progress"><span>{completed} de {total} pasos completados{skipped > 0 ? ` · ${skipped} omitidos` : ''}</span><progress max={total} value={visited} aria-label="Avance del tutorial" /></div>
      <div className="tutorial-course-stage">
        <TutorialWorkspace key={`workspace:${step.id}:${visit}`} ref={sandboxRef} chapter={chapter} step={step} mode={progress.mode} onAction={action} completedActions={progress.completedStepIds} />
        <TutorialPlayer
          key={`player:${step.id}:${visit}`}
          chapters={chapters} chapterIndex={position.chapterIndex} stepIndex={position.stepIndex}
          mode={progress.mode} paused={paused} speed={progress.speed} audioEnabled={audioEnabled}
          actionCompleted={actionCompleted} sandboxRef={sandboxRef}
          focusHeadingOnMount={focusHeadingOnMount} onNavigationFocus={(origin) => setFocusHeadingOnMount(origin === 'manual')}
          onPauseChange={setPaused} onNext={() => advance(actionCompleted ? 'completed' : 'skipped')} onSkipStep={() => advance('skipped')}
          onPrevious={() => { const previous = moveTutorialPosition(chapters, position.chapterIndex, position.stepIndex, -1); if (previous) goTo(previous.chapterIndex, previous.stepIndex); }}
          onSkipChapter={skipChapter} onSelectChapter={(id) => { const index = chapters.findIndex((item) => item.id === id); if (index >= 0) { goTo(index, 0); setPaused(true); } }}
          onExit={exit} onModeChange={(mode) => { setProgress((current) => current ? { ...current, mode } : current); setPaused(true); setActionCompleted(false); setVisit((current) => current + 1); }}
          onSpeedChange={(speed) => setProgress((current) => current ? { ...current, speed } : current)}
          onAudioEnabledChange={setAudioEnabled}
        />
      </div>
      <div className="tutorial-course-real-link"><span>Estás trabajando con ejemplos ficticios.</span><Link href={step.route} onClick={() => setPaused(true)}>Abrir esta sección de la aplicación ↗</Link></div>
      <nav className="tutorial-mobile-controls" aria-label="Controles rápidos del tutorial">
        <button type="button" aria-pressed={paused} onClick={() => setPaused((current) => !current)}>{paused ? 'Continuar' : 'Pausar'}</button>
        <button type="button" disabled={progress.mode === 'practice' && !actionCompleted} onClick={() => { setFocusHeadingOnMount(true); advance(actionCompleted ? 'completed' : 'skipped'); }}>Siguiente →</button>
        <button type="button" onClick={() => { setFocusHeadingOnMount(true); advance('skipped'); }}>Saltar</button>
        <button type="button" onClick={exit}>Salir</button>
      </nav>
    </> : active && progress.finished ? <section className="tutorial-completion card" aria-live="polite">
      <span className="tutorial-completion-mark" aria-hidden="true">✓</span><span className="eyebrow">Recorrido finalizado</span><h2>Ya puedes seguir con tus expedientes</h2>
      <p>Completaste {completed} de {total} pasos.{skipped > 0 ? ` Dejaste ${skipped} pasos para revisar después.` : ' Puedes repetir cualquier capítulo cuando lo necesites.'}</p>
      <div className="tutorial-completion-actions"><button type="button" className="button primary" onClick={() => start('practice', false)}>Practicar desde el inicio</button><button type="button" className="button secondary" onClick={exit}>Elegir otro capítulo</button><Link href="/expedientes" className="text-link">Ir a mis expedientes ↗</Link></div>
    </section> : <>
      <section className="tutorial-welcome card">
        <div className="tutorial-welcome-copy"><span className="tutorial-safety-badge">Entorno de práctica · datos ficticios</span><h2>Todo el flujo, paso a paso.</h2><p>Un cursor te muestra dónde hacer clic y una explicación te acompaña en cada función. Puedes pausar, saltar pasos o tomar el control.</p><p className="tutorial-welcome-safety">Los guardados, análisis de IA, firmas y envíos de este tutorial son simulados. Tus expedientes permanecen en la aplicación.</p>
          <div className="tutorial-course-stats"><span><strong>{chapters.length}</strong> capítulos</span><span><strong>{total}</strong> pasos</span><span><strong>~{minutes(duration)}</strong> min a velocidad normal</span></div>
        </div>
        <div className="tutorial-mode-cards">
          <article><span aria-hidden="true">▶</span><h3>Ver demostración</h3><p>Observa los clics y los resultados. Avanza automáticamente después de cada explicación.</p><button type="button" className="button primary" onClick={() => start('demo', false)}>Iniciar demostración</button></article>
          <article><span aria-hidden="true">☞</span><h3>Practicar conmigo</h3><p>Realiza tú cada acción. El tutorial espera tu clic y te deja avanzar cuando estés listo.</p><button type="button" className="button secondary" onClick={() => start('practice', false)}>Iniciar práctica</button></article>
        </div>
      </section>
      {hasProgress && <section className="tutorial-resume card"><div><strong>{progress.finished ? 'Tu recorrido está guardado' : 'Continúa donde lo dejaste'}</strong><p>{chapter.title} · {step.title} · {completed} pasos completados{skipped ? ` y ${skipped} omitidos` : ''}.</p></div><button type="button" className="button primary" onClick={() => start(progress.mode, true)}>Retomar recorrido</button></section>}
      <div className="tutorial-curriculum-heading"><div><h2>Elige un capítulo</h2><p>Contenido para tu perfil de {roleLabels[account.role].toLowerCase()}. Puedes recorrerlo en cualquier orden.</p></div><small>{storageAvailable ? 'Tu avance se guarda en este navegador para tu cuenta.' : 'Tu avance se conserva durante esta visita; el navegador no permite guardarlo.'}</small></div>
      <div className="tutorial-curriculum">{chapters.map((item, index) => {
        const seen = item.steps.filter((itemStep) => progress.completedStepIds.includes(itemStep.id)).length;
        const itemDuration = item.steps.reduce((sum, itemStep) => sum + itemStep.durationSeconds, 0);
        return <article className="tutorial-chapter-card" key={item.id}><span className="tutorial-chapter-icon" aria-hidden="true">{item.icon}</span><div className="tutorial-chapter-copy"><small>Capítulo {index + 1} · {item.steps.length} pasos · ~{minutes(itemDuration)} min</small><h3>{item.title}</h3><p>{item.description}</p><div className="tutorial-chapter-meta"><span>{seen > 0 ? `${seen}/${item.steps.length} completados` : 'Por explorar'}</span><button type="button" onClick={() => start(progress.mode, true, item.id)} aria-label={`Abrir capítulo ${item.title}`}>Comenzar ↗</button></div></div></article>;
      })}</div>
    </>}
  </div>;
}
