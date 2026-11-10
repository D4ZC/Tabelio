'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TutorialChapter } from '@/lib/tutorial-catalog';
import {
  clickTutorialDemoTarget, findTutorialDemoTarget, tickTutorialClock, tutorialDurationMs,
  tutorialGlobalPosition, type TutorialMode,
} from '@/lib/tutorial-player';
import './tutorial-player.css';

export interface TutorialPlayerProps {
  chapters: TutorialChapter[];
  chapterIndex: number;
  stepIndex: number;
  mode: TutorialMode;
  paused: boolean;
  speed: number;
  audioEnabled: boolean;
  actionCompleted: boolean;
  sandboxRef: RefObject<HTMLDivElement | null>;
  onPauseChange: (paused: boolean) => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkipStep: () => void;
  onSkipChapter: () => void;
  onSelectChapter: (chapterId: string) => void;
  onExit: () => void;
  onModeChange: (mode: TutorialMode) => void;
  onSpeedChange: (speed: number) => void;
  onAudioEnabledChange: (enabled: boolean) => void;
  focusHeadingOnMount?: boolean;
  onNavigationFocus?: (origin: 'manual' | 'automatic') => void;
}

interface TargetRect { left: number; top: number; width: number; height: number }

function sameRect(left: TargetRect | null, right: TargetRect | null) {
  if (!left || !right) return left === right;
  return Math.abs(left.left - right.left) < 0.5 && Math.abs(left.top - right.top) < 0.5
    && Math.abs(left.width - right.width) < 0.5 && Math.abs(left.height - right.height) < 0.5;
}

function isEditing(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest('input, textarea, select, button, [contenteditable="true"]'));
}

export function TutorialPlayer(props: TutorialPlayerProps) {
  const { chapters, chapterIndex, stepIndex, mode, paused, speed, audioEnabled, actionCompleted, sandboxRef } = props;
  const chapter = chapters[chapterIndex];
  const step = chapter?.steps[stepIndex];
  const stepId = step?.id ?? '';
  const durationMs = tutorialDurationMs(step?.durationSeconds ?? 15);
  const position = tutorialGlobalPosition(chapters, { chapterIndex, stepIndex });
  const callbacks = useRef(props);
  callbacks.current = props;
  const [hidden, setHidden] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [remainingMs, setRemainingMs] = useState(durationMs);
  const remainingRef = useRef(durationMs);
  const advancedStep = useRef('');
  const [targetRect, setTargetRect] = useState<TargetRect | null>(null);
  const [cursorPosition, setCursorPosition] = useState<{ left: number; top: number } | null>(null);
  const [targetReady, setTargetReady] = useState(false);
  const [clicked, setClicked] = useState(false);
  const [problem, setProblem] = useState('');
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [voiceError, setVoiceError] = useState('');
  const narratedStep = useRef('');
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!props.focusHeadingOnMount) return;
    const frame = requestAnimationFrame(() => headingRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [stepId, props.focusHeadingOnMount]);

  function manualNavigation(action: () => void) {
    callbacks.current.onNavigationFocus?.('manual');
    action();
  }

  useEffect(() => {
    if (!targetRect || mode !== 'demo') return;
    const destination = {
      left: targetRect.left + Math.min(targetRect.width * 0.65, targetRect.width - 12),
      top: targetRect.top + targetRect.height * 0.55,
    };
    if (reducedMotion) { setCursorPosition(destination); return; }
    const origin = sandboxRef.current?.getBoundingClientRect();
    setCursorPosition((current) => current ?? {
      left: Math.max(8, Math.min(window.innerWidth - 35, (origin?.left ?? targetRect.left) + 22)),
      top: Math.max(12, Math.min(window.innerHeight - 45, (origin?.top ?? targetRect.top) + 55)),
    });
    let nextFrame = 0;
    const frame = requestAnimationFrame(() => {
      nextFrame = requestAnimationFrame(() => setCursorPosition(destination));
    });
    return () => { cancelAnimationFrame(frame); cancelAnimationFrame(nextFrame); };
  }, [targetRect, mode, reducedMotion, sandboxRef]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const visibility = () => {
      setHidden(document.hidden);
      if (document.hidden) callbacks.current.onPauseChange(true);
    };
    const modal = () => {
      const open = Boolean(document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]'));
      setDialogOpen(open);
      if (open) callbacks.current.onPauseChange(true);
    };
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Element && sandboxRef.current?.contains(event.target)
        && event.target.closest('input, textarea, select, [contenteditable="true"]')) callbacks.current.onPauseChange(true);
    };
    const blur = () => callbacks.current.onPauseChange(true);
    visibility();
    modal();
    document.addEventListener('visibilitychange', visibility);
    document.addEventListener('focusin', focus);
    window.addEventListener('blur', blur);
    const observer = new MutationObserver(modal);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['open', 'aria-modal'] });
    return () => {
      document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('focusin', focus);
      window.removeEventListener('blur', blur);
      observer.disconnect();
    };
  }, [sandboxRef]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat || event.altKey || event.metaKey || event.ctrlKey || dialogOpen) return;
      const writing = event.target instanceof Element && Boolean(event.target.closest('input, textarea, select, [contenteditable="true"]'));
      if (event.key === 'Escape' && !writing) { event.preventDefault(); callbacks.current.onExit(); }
      else if (event.code === 'Space' && !isEditing(event.target)) { event.preventDefault(); callbacks.current.onPauseChange(!paused); }
    };
    document.addEventListener('keydown', keyboard);
    return () => document.removeEventListener('keydown', keyboard);
  }, [paused, dialogOpen]);

  useEffect(() => {
    remainingRef.current = durationMs;
    advancedStep.current = '';
    setRemainingMs(durationMs);
    setProblem('');
    setClicked(false);
  }, [stepId, mode, durationMs]);

  useEffect(() => {
    if (!step) return;
    let active = true;
    let frame = 0;
    const root = sandboxRef.current;
    const measure = () => {
      if (!active) return;
      const candidate = root?.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`);
      const rect = candidate?.getBoundingClientRect();
      const next = candidate && root?.contains(candidate) && rect && rect.width > 0 && rect.height > 0
        ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : null;
      setTargetRect((current) => sameRect(current, next) ? current : next);
      setTargetReady(Boolean(findTutorialDemoTarget(root, step.target, step.id)));
    };
    const queue = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    setTargetRect(null);
    setTargetReady(false);
    const scrollFrame = requestAnimationFrame(() => {
      const element = root?.querySelector<HTMLElement>(`[data-tutorial-target="${step.target}"]`);
      element?.scrollIntoView({ block: 'center', inline: 'nearest', behavior: reducedMotion ? 'instant' : 'smooth' });
      queue();
    });
    const settled = window.setTimeout(queue, reducedMotion ? 50 : 700);
    const observer = new MutationObserver(queue);
    if (root) observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'aria-disabled'] });
    const resize = new ResizeObserver(queue);
    if (root) resize.observe(root);
    window.addEventListener('resize', queue);
    window.addEventListener('scroll', queue, true);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      cancelAnimationFrame(scrollFrame);
      window.clearTimeout(settled);
      observer.disconnect();
      resize.disconnect();
      window.removeEventListener('resize', queue);
      window.removeEventListener('scroll', queue, true);
    };
  }, [stepId, step, sandboxRef, reducedMotion]);

  useEffect(() => {
    if (!step || mode !== 'demo' || paused || hidden || dialogOpen || actionCompleted) return;
    if (!targetReady) {
      const timer = window.setTimeout(() => {
        setProblem('La acción de este paso todavía no está disponible. Puedes completarla manualmente o saltar el paso.');
        callbacks.current.onPauseChange(true);
      }, 3500);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => {
      if (document.hidden || !sandboxRef.current?.isConnected) return;
      const success = clickTutorialDemoTarget(sandboxRef.current, step.target, step.id);
      if (success) { setClicked(true); setProblem(''); }
      else {
        setProblem('Se detuvo el clic automático porque cambió la acción visible. Puedes continuar manualmente o saltar el paso.');
        callbacks.current.onPauseChange(true);
      }
    }, reducedMotion ? 200 : 1200);
    return () => window.clearTimeout(timer);
  }, [stepId, step, mode, paused, hidden, dialogOpen, actionCompleted, targetReady, targetRect, sandboxRef, reducedMotion]);

  useEffect(() => {
    if (!clicked) return;
    const timer = window.setTimeout(() => setClicked(false), reducedMotion ? 100 : 650);
    return () => window.clearTimeout(timer);
  }, [clicked, reducedMotion]);

  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const update = () => setVoices(window.speechSynthesis.getVoices().filter((voice) => voice.localService && /^es(?:-|$)/i.test(voice.lang)));
    update();
    window.speechSynthesis.addEventListener('voiceschanged', update);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update);
  }, []);

  useEffect(() => {
    if (!step || !audioEnabled || paused || hidden || dialogOpen || !voices.length || narratedStep.current === step.id) return;
    const utterance = new SpeechSynthesisUtterance(`${step.title}. ${step.explanation} ${step.instruction}`);
    const voice = voices.find((candidate) => candidate.lang.toLowerCase() === 'es-mx') ?? voices[0];
    utterance.voice = voice;
    utterance.lang = voice.lang;
    utterance.rate = Math.max(0.6, Math.min(1.5, speed));
    utteranceRef.current = utterance;
    setSpeaking(true);
    setVoiceError('');
    utterance.onend = () => {
      if (utteranceRef.current !== utterance) return;
      narratedStep.current = step.id;
      utteranceRef.current = null;
      setSpeaking(false);
    };
    utterance.onerror = () => {
      if (utteranceRef.current !== utterance) return;
      narratedStep.current = step.id;
      utteranceRef.current = null;
      setSpeaking(false);
      setVoiceError('La voz del navegador no pudo reproducirse. Puedes continuar con la explicación escrita.');
    };
    try { window.speechSynthesis.speak(utterance); } catch {
      utteranceRef.current = null;
      narratedStep.current = step.id;
      setSpeaking(false);
      setVoiceError('La voz del navegador no pudo iniciarse. Puedes continuar con la explicación escrita.');
    }
    return () => {
      if (utteranceRef.current === utterance) {
        utteranceRef.current = null;
        window.speechSynthesis.cancel();
        setSpeaking(false);
      }
    };
  }, [stepId, step, audioEnabled, paused, hidden, dialogOpen, voices, speed]);

  useEffect(() => {
    const conditions = { mode, actionCompleted, paused, hidden, dialogOpen, speaking };
    let previous = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      const state = tickTutorialClock(remainingRef.current, now - previous, speed, conditions);
      previous = now;
      if (state.remainingMs !== remainingRef.current) {
        remainingRef.current = state.remainingMs;
        setRemainingMs(state.remainingMs);
      }
      if (state.advance && stepId && advancedStep.current !== stepId) {
        advancedStep.current = stepId;
        callbacks.current.onNavigationFocus?.('automatic');
        callbacks.current.onNext();
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [stepId, mode, actionCompleted, paused, hidden, dialogOpen, speaking, speed]);

  if (!step || !chapter) return null;
  const remainingSeconds = Math.max(0, Math.ceil(remainingMs / (Math.max(0.5, Math.min(2, speed)) * 1000)));
  const percent = Math.max(0, Math.min(100, remainingMs / durationMs * 100));
  const status = mode === 'practice'
    ? actionCompleted ? 'Acción completada. Puedes avanzar cuando estés listo.' : 'Tu turno: completa la acción indicada o salta el paso.'
    : paused || hidden || dialogOpen ? 'Recorrido en pausa.' : speaking ? 'Escuchando la explicación…'
      : !actionCompleted ? 'El cursor mostrará la acción en el entorno de práctica.' : `Siguiente paso en ${remainingSeconds} s`;

  return <>
    <aside className="tutorial-player" aria-label="Controles del tutorial">
      <div className="tutorial-player-topline"><span>Guía del cliente</span><button type="button" onClick={props.onExit} className="tutorial-player-exit">Salir <span aria-hidden="true">↗</span></button></div>
      <label className="tutorial-player-chapters">Capítulo<select aria-label="Elegir capítulo del tutorial" value={chapter.id} onChange={(event) => manualNavigation(() => props.onSelectChapter(event.target.value))}>{chapters.map((entry, index) => <option value={entry.id} key={entry.id}>{index + 1}. {entry.title}</option>)}</select></label>
      <div className="tutorial-player-step-meta"><span>Paso {stepIndex + 1} de {chapter.steps.length}</span><span>{position.index + 1} / {position.total}</span></div>
      <div className="tutorial-player-overall" role="progressbar" aria-label="Avance del recorrido" aria-valuemin={0} aria-valuemax={position.total} aria-valuenow={position.index + 1}><span style={{ width: `${position.total ? ((position.index + 1) / position.total) * 100 : 0}%` }} /></div>
      <div className="tutorial-player-explanation" aria-live={props.focusHeadingOnMount ? 'off' : 'polite'} aria-atomic="true"><h2 ref={headingRef} tabIndex={-1}>{step.title}</h2><p>{step.explanation}</p><div className="tutorial-player-instruction"><strong>{mode === 'practice' ? 'Hazlo tú' : 'Observa la acción'}</strong><p>{step.instruction}</p></div></div>
      {actionCompleted && <div className="tutorial-player-completed" role="status"><span aria-hidden="true">✓</span><div><strong>Resultado esperado del ejemplo</strong><p>{step.result}</p></div></div>}
      {problem && <p className="tutorial-player-problem" role="alert">{problem}</p>}
      <div className="tutorial-player-settings">
        <label>Modalidad<select value={mode} onChange={(event) => manualNavigation(() => props.onModeChange(event.target.value as TutorialMode))}><option value="demo">Ver demostración</option><option value="practice">Practicar conmigo</option></select></label>
        <label>Velocidad<select value={speed} onChange={(event) => props.onSpeedChange(Number(event.target.value))}><option value={0.75}>Lenta · 0.75×</option><option value={1}>Normal · 1×</option><option value={1.5}>Rápida · 1.5×</option><option value={2}>Muy rápida · 2×</option></select></label>
      </div>
      <label className="tutorial-player-audio"><input type="checkbox" checked={audioEnabled} disabled={!voices.length} onChange={(event) => props.onAudioEnabledChange(event.target.checked)} /><span>Escuchar explicación<small>{voices.length ? 'Voz instalada en el navegador · opcional' : 'No hay una voz local en español disponible; puedes seguir leyendo.'}</small></span></label>
      {voiceError && <p className="tutorial-player-problem" role="status">{voiceError}</p>}
      <div className="tutorial-player-timing"><p aria-live="off">{status}</p>{mode === 'demo' && <div className="tutorial-player-countdown" aria-hidden="true"><span style={{ width: `${percent}%` }} /></div>}</div>
      <div className="tutorial-player-main-controls">
        <button type="button" disabled={position.index === 0} onClick={() => manualNavigation(props.onPrevious)}>← Anterior</button>
        <button type="button" className="tutorial-player-pause" aria-pressed={paused} onClick={() => props.onPauseChange(!paused)}>{paused ? 'Continuar' : 'Pausar'}</button>
        <button type="button" className="tutorial-player-next" disabled={mode === 'practice' && !actionCompleted} onClick={() => manualNavigation(props.onNext)}>{position.index + 1 === position.total ? 'Finalizar' : 'Siguiente'} →</button>
      </div>
      <div className="tutorial-player-skip-controls"><button type="button" onClick={() => manualNavigation(props.onSkipStep)}>Saltar explicación</button><button type="button" onClick={() => manualNavigation(props.onSkipChapter)}>Saltar capítulo</button></div>
      <p className="tutorial-player-help">{mode === 'practice' ? 'La práctica espera tu acción; también puedes saltar cualquier paso.' : 'Al editar un campo o cambiar de pestaña, el recorrido se pausa.'} Espacio: pausar · Esc: salir.</p>
    </aside>
    {targetRect && !hidden && <div className={`tutorial-player-pointer-layer ${reducedMotion ? 'is-reduced-motion' : ''}`} aria-hidden="true">
      <div className={`tutorial-player-target ${actionCompleted ? 'is-complete' : ''}`} style={{ left: targetRect.left - 6, top: targetRect.top - 6, width: targetRect.width + 12, height: targetRect.height + 12 }} />
      {mode === 'demo' && cursorPosition && <div className={`tutorial-player-cursor ${clicked ? 'is-clicking' : ''}`} style={cursorPosition}><svg viewBox="0 0 30 38" width="30" height="38"><path d="M3 2 25 23 15 24 12 35 8 33 10 23 3 28Z" fill="white" stroke="#173f31" strokeWidth="2.4" strokeLinejoin="round" /></svg><span className="tutorial-player-click-ring" /></div>}
    </div>}
  </>;
}
