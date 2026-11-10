import { TUTORIAL_CATALOG_VERSION, type TutorialChapter } from './tutorial-catalog';

export type TutorialMode = 'demo' | 'practice';

export interface TutorialProgress {
  version: number;
  chapterId: string;
  stepId: string;
  mode: TutorialMode;
  speed: number;
  completedStepIds: string[];
  skippedStepIds: string[];
  finished: boolean;
}

export function tutorialStorageKey(organizationId: string, userId: string, role: string) {
  return `despacho_tutorial:${TUTORIAL_CATALOG_VERSION}:${encodeURIComponent(organizationId)}:${encodeURIComponent(userId)}:${encodeURIComponent(role)}`;
}

export function initialTutorialProgress(chapters: TutorialChapter[], mode: TutorialMode = 'demo'): TutorialProgress {
  return {
    version: TUTORIAL_CATALOG_VERSION,
    chapterId: chapters[0]?.id ?? '', stepId: chapters[0]?.steps[0]?.id ?? '',
    mode, speed: 1, completedStepIds: [], skippedStepIds: [], finished: false,
  };
}

export function parseTutorialProgress(raw: string | null, chapters: TutorialChapter[]): TutorialProgress {
  const initial = initialTutorialProgress(chapters);
  if (!raw || raw.length > 100_000) return initial;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return initial;
    const data = value as Record<string, unknown>;
    if (data.version !== TUTORIAL_CATALOG_VERSION) return initial;
    const validIds = new Set(chapters.flatMap((chapter) => chapter.steps.map((step) => step.id)));
    const chapter = chapters.find((candidate) => candidate.id === data.chapterId);
    const step = chapter?.steps.find((candidate) => candidate.id === data.stepId);
    const ids = (list: unknown) => Array.isArray(list)
      ? [...new Set(list.filter((id): id is string => typeof id === 'string' && validIds.has(id)))].slice(0, validIds.size) : [];
    const completedStepIds = ids(data.completedStepIds);
    return {
      ...initial,
      ...(chapter && step ? { chapterId: chapter.id, stepId: step.id } : {}),
      mode: data.mode === 'practice' ? 'practice' : 'demo',
      speed: [0.75, 1, 1.5, 2].includes(Number(data.speed)) ? Number(data.speed) : 1,
      completedStepIds,
      skippedStepIds: ids(data.skippedStepIds).filter((id) => !completedStepIds.includes(id)),
      finished: data.finished === true && Boolean(chapter && step),
    };
  } catch { return initial; }
}

export function tutorialPosition(chapters: TutorialChapter[], progress: Pick<TutorialProgress, 'chapterId' | 'stepId'>) {
  const found = chapters.findIndex((chapter) => chapter.id === progress.chapterId);
  const chapterIndex = found >= 0 ? found : 0;
  const stepIndex = Math.max(0, chapters[chapterIndex]?.steps.findIndex((step) => step.id === progress.stepId) ?? 0);
  return { chapterIndex, stepIndex };
}

export function moveTutorialPosition(chapters: TutorialChapter[], chapterIndex: number, stepIndex: number, direction: 1 | -1) {
  if (!chapters.length) return null;
  if (direction === 1) {
    if (stepIndex + 1 < chapters[chapterIndex].steps.length) return { chapterIndex, stepIndex: stepIndex + 1 };
    if (chapterIndex + 1 < chapters.length) return { chapterIndex: chapterIndex + 1, stepIndex: 0 };
    return null;
  }
  if (stepIndex > 0) return { chapterIndex, stepIndex: stepIndex - 1 };
  if (chapterIndex > 0) return { chapterIndex: chapterIndex - 1, stepIndex: chapters[chapterIndex - 1].steps.length - 1 };
  return null;
}

export function markTutorialStep(progress: TutorialProgress, stepId: string, outcome: 'completed' | 'skipped') {
  return {
    ...progress,
    completedStepIds: outcome === 'completed' ? [...new Set([...progress.completedStepIds, stepId])] : progress.completedStepIds,
    skippedStepIds: outcome === 'completed'
      ? progress.skippedStepIds.filter((id) => id !== stepId)
      : progress.completedStepIds.includes(stepId) ? progress.skippedStepIds : [...new Set([...progress.skippedStepIds, stepId])],
  };
}
