import { describe, expect, it } from 'vitest';
import { chaptersForRole, TUTORIAL_CATALOG_VERSION, tutorialChapters } from './tutorial-catalog';
import { initialTutorialProgress, markTutorialStep, moveTutorialPosition, parseTutorialProgress, tutorialPosition, tutorialStorageKey } from './tutorial-progress';

describe('progreso privado por cuenta del tutorial', () => {
  it('aísla progreso por organización, persona y perfil sin colisiones por separadores', () => {
    const keys = [tutorialStorageKey('org', 'a:b', 'ADMIN'), tutorialStorageKey('org:a', 'b', 'ADMIN'), tutorialStorageKey('org', 'a:b', 'VIEWER'), tutorialStorageKey('other', 'a:b', 'ADMIN')];
    expect(new Set(keys).size).toBe(4);
  });

  it('descarta datos corruptos, versiones antiguas y valores fuera del catálogo', () => {
    const chapters = chaptersForRole('VIEWER');
    const initial = initialTutorialProgress(chapters);
    expect(parseTutorialProgress('{bad', chapters)).toEqual(initial);
    expect(parseTutorialProgress(JSON.stringify({ ...initial, version: -1 }), chapters)).toEqual(initial);
    const parsed = parseTutorialProgress(JSON.stringify({ ...initial, speed: 999, mode: 'auto-save', completedStepIds: ['unknown', initial.stepId, initial.stepId] }), chapters);
    expect(parsed.completedStepIds).toEqual([initial.stepId]);
    expect(parsed.mode).toBe('demo');
    expect(parsed.speed).toBe(1);
  });

  it('no restaura capítulos ni pasos fuera del perfil actual', () => {
    const viewer = chaptersForRole('VIEWER');
    const allowedIds = new Set(viewer.flatMap((chapter) => chapter.steps.map((step) => step.id)));
    const restricted = tutorialChapters.flatMap((chapter) => chapter.steps.map((step) => ({ chapter, step }))).find(({ step }) => !allowedIds.has(step.id));
    expect(restricted).toBeDefined();
    const parsed = parseTutorialProgress(JSON.stringify({ version: TUTORIAL_CATALOG_VERSION, chapterId: restricted!.chapter.id, stepId: restricted!.step.id, finished: true, completedStepIds: [restricted!.step.id] }), viewer);
    expect(parsed.chapterId).toBe(viewer[0].id);
    expect(parsed.finished).toBe(false);
    expect(parsed.completedStepIds).toEqual([]);
  });

  it('completar un paso antes saltado retira el salto sin duplicar avances', () => {
    let progress = initialTutorialProgress(tutorialChapters);
    progress = markTutorialStep(progress, progress.stepId, 'skipped');
    progress = markTutorialStep(progress, progress.stepId, 'completed');
    progress = markTutorialStep(progress, progress.stepId, 'completed');
    expect(progress.completedStepIds).toEqual([progress.stepId]);
    expect(progress.skippedStepIds).toEqual([]);
  });

  it('atraviesa los capítulos en ambos sentidos y termina en los límites', () => {
    const chapters = tutorialChapters.slice(0, 2);
    expect(moveTutorialPosition(chapters, 0, 0, -1)).toBeNull();
    expect(moveTutorialPosition(chapters, 0, chapters[0].steps.length - 1, 1)).toEqual({ chapterIndex: 1, stepIndex: 0 });
    expect(moveTutorialPosition(chapters, 1, 0, -1)).toEqual({ chapterIndex: 0, stepIndex: chapters[0].steps.length - 1 });
    expect(moveTutorialPosition(chapters, 1, chapters[1].steps.length - 1, 1)).toBeNull();
    expect(tutorialPosition(chapters, { chapterId: 'missing', stepId: 'missing' })).toEqual({ chapterIndex: 0, stepIndex: 0 });
  });
});
