export type TutorialMode = 'demo' | 'practice';

export interface TutorialPosition { chapterIndex: number; stepIndex: number }
export interface TutorialChapterShape { id: string; steps: ReadonlyArray<{ id: string }> }

export function validTutorialPosition(chapters: ReadonlyArray<TutorialChapterShape>, position: TutorialPosition): boolean {
  return Number.isInteger(position.chapterIndex) && Number.isInteger(position.stepIndex)
    && position.chapterIndex >= 0 && position.stepIndex >= 0
    && Boolean(chapters[position.chapterIndex]?.steps[position.stepIndex]);
}

/** Returns null only when the requested direction has reached the end. */
export function nextTutorialPosition(
  chapters: ReadonlyArray<TutorialChapterShape>, position: TutorialPosition,
  direction: 'next' | 'previous' | 'chapter' = 'next',
): TutorialPosition | null {
  if (!validTutorialPosition(chapters, position)) return null;
  const { chapterIndex, stepIndex } = position;
  if (direction === 'previous') {
    if (stepIndex > 0) return { chapterIndex, stepIndex: stepIndex - 1 };
    for (let index = chapterIndex - 1; index >= 0; index -= 1) {
      if (chapters[index].steps.length) return { chapterIndex: index, stepIndex: chapters[index].steps.length - 1 };
    }
    return null;
  }
  if (direction === 'next' && stepIndex + 1 < chapters[chapterIndex].steps.length) return { chapterIndex, stepIndex: stepIndex + 1 };
  for (let index = chapterIndex + 1; index < chapters.length; index += 1) {
    if (chapters[index].steps.length) return { chapterIndex: index, stepIndex: 0 };
  }
  return null;
}

export function tutorialGlobalPosition(chapters: ReadonlyArray<TutorialChapterShape>, position: TutorialPosition) {
  if (!validTutorialPosition(chapters, position)) return { index: 0, total: chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0) };
  return {
    index: chapters.slice(0, position.chapterIndex).reduce((sum, chapter) => sum + chapter.steps.length, 0) + position.stepIndex,
    total: chapters.reduce((sum, chapter) => sum + chapter.steps.length, 0),
  };
}

export function tutorialDurationMs(seconds: number) {
  return Math.max(3, Math.min(120, Number.isFinite(seconds) ? seconds : 15)) * 1000;
}

export interface TutorialClockConditions {
  mode: TutorialMode;
  actionCompleted: boolean;
  paused: boolean;
  hidden: boolean;
  dialogOpen: boolean;
  speaking: boolean;
}

export function tutorialCanRunClock(conditions: TutorialClockConditions) {
  return conditions.mode === 'demo' && conditions.actionCompleted && !conditions.paused
    && !conditions.hidden && !conditions.dialogOpen && !conditions.speaking;
}

export function tickTutorialClock(remainingMs: number, elapsedMs: number, speed: number, conditions: TutorialClockConditions) {
  if (!tutorialCanRunClock(conditions)) return { remainingMs, advance: false };
  const rate = Number.isFinite(speed) ? Math.max(0.5, Math.min(2, speed)) : 1;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, Math.min(elapsedMs, 1000)) : 0;
  const next = Math.max(0, remainingMs - elapsed * rate);
  return { remainingMs: next, advance: next === 0 };
}

const SAFE_TARGET = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,160}$/;

/** Only a sandbox-owned button with a matching action may receive a demo click. */
export function findTutorialDemoTarget(root: HTMLElement | null, target: string, actionId: string): HTMLButtonElement | null {
  if (!root || !SAFE_TARGET.test(target) || !SAFE_TARGET.test(actionId) || !root.isConnected) return null;
  const candidate = root.querySelector<HTMLButtonElement>(`[data-tutorial-target="${target}"]`);
  if (!candidate || !root.contains(candidate) || candidate.tagName !== 'BUTTON'
    || candidate.getAttribute('type') !== 'button'
    || candidate.getAttribute('data-tutorial-demo-safe') !== 'true'
    || candidate.getAttribute('data-tutorial-action') !== actionId
    || candidate.getAttribute('aria-disabled') === 'true' || candidate.disabled || candidate.hidden
    || candidate.closest('[hidden], [inert], [aria-hidden="true"]')) return null;
  return candidate;
}

export function clickTutorialDemoTarget(root: HTMLElement | null, target: string, actionId: string): boolean {
  const button = findTutorialDemoTarget(root, target, actionId);
  if (!button) return false;
  button.click();
  return true;
}
