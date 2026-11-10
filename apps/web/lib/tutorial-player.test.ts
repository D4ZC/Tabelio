import { describe, expect, it, vi } from 'vitest';
import {
  clickTutorialDemoTarget, findTutorialDemoTarget, nextTutorialPosition, tickTutorialClock,
  tutorialCanRunClock, tutorialDurationMs, tutorialGlobalPosition, validTutorialPosition,
  type TutorialClockConditions,
} from './tutorial-player';

const chapters = [{ id: 'one', steps: [{ id: 'a' }, { id: 'b' }] }, { id: 'empty', steps: [] }, { id: 'two', steps: [{ id: 'c' }] }];
const clock: TutorialClockConditions = { mode: 'demo', actionCompleted: true, paused: false, hidden: false, dialogOpen: false, speaking: false };

describe('navigation between tutorial chapters', () => {
  it('crosses chapter boundaries, skips empty chapters and finishes once at the end', () => {
    expect(nextTutorialPosition(chapters, { chapterIndex: 0, stepIndex: 0 })).toEqual({ chapterIndex: 0, stepIndex: 1 });
    expect(nextTutorialPosition(chapters, { chapterIndex: 0, stepIndex: 1 })).toEqual({ chapterIndex: 2, stepIndex: 0 });
    expect(nextTutorialPosition(chapters, { chapterIndex: 0, stepIndex: 0 }, 'chapter')).toEqual({ chapterIndex: 2, stepIndex: 0 });
    expect(nextTutorialPosition(chapters, { chapterIndex: 2, stepIndex: 0 })).toBeNull();
    expect(nextTutorialPosition(chapters, { chapterIndex: 2, stepIndex: 0 }, 'previous')).toEqual({ chapterIndex: 0, stepIndex: 1 });
    expect(nextTutorialPosition(chapters, { chapterIndex: 0, stepIndex: 0 }, 'previous')).toBeNull();
  });

  it('rejects invalid saved positions and counts only available steps', () => {
    for (const position of [{ chapterIndex: -1, stepIndex: 0 }, { chapterIndex: 0.2, stepIndex: 0 }, { chapterIndex: 0, stepIndex: 2 }, { chapterIndex: 1, stepIndex: 0 }]) {
      expect(validTutorialPosition(chapters, position)).toBe(false);
      expect(nextTutorialPosition(chapters, position)).toBeNull();
    }
    expect(tutorialGlobalPosition(chapters, { chapterIndex: 2, stepIndex: 0 })).toEqual({ index: 2, total: 3 });
    expect(tutorialGlobalPosition([], { chapterIndex: 0, stepIndex: 0 })).toEqual({ index: 0, total: 0 });
  });
});

describe('tutorial clock and practice gating', () => {
  it.each(['paused', 'hidden', 'dialogOpen', 'speaking'] as const)('holds the countdown while %s', (flag) => {
    expect(tickTutorialClock(5000, 1000, 1, { ...clock, [flag]: true })).toEqual({ remainingMs: 5000, advance: false });
  });

  it('does not advance practice or a demonstration before the matching action completes', () => {
    expect(tutorialCanRunClock({ ...clock, mode: 'practice' })).toBe(false);
    expect(tickTutorialClock(1000, 1000, 2, { ...clock, mode: 'practice' })).toEqual({ remainingMs: 1000, advance: false });
    expect(tickTutorialClock(1000, 1000, 1, { ...clock, actionCompleted: false })).toEqual({ remainingMs: 1000, advance: false });
  });

  it('uses speed, clamps delayed ticks and cannot skip several unseen steps after tab inactivity', () => {
    expect(tickTutorialClock(1500, 1000, 1.5, clock)).toEqual({ remainingMs: 0, advance: true });
    expect(tickTutorialClock(5000, 60_000, 1, clock)).toEqual({ remainingMs: 4000, advance: false });
    expect(tickTutorialClock(5000, -1, 1, clock)).toEqual({ remainingMs: 5000, advance: false });
    expect(tickTutorialClock(5000, Number.NaN, 1, clock)).toEqual({ remainingMs: 5000, advance: false });
    expect(tutorialDurationMs(1)).toBe(3000);
    expect(tutorialDurationMs(500)).toBe(120_000);
    expect(tutorialDurationMs(Number.NaN)).toBe(15_000);
  });
});

function sandbox() {
  const attributes: Record<string, string> = {
    type: 'button', 'data-tutorial-demo-safe': 'true', 'data-tutorial-action': 'step-one',
  };
  const button = { tagName: 'BUTTON', disabled: false, hidden: false, getAttribute: (name: string) => attributes[name] ?? null, closest: vi.fn().mockReturnValue(null), click: vi.fn() };
  const root = { isConnected: true, querySelector: vi.fn().mockReturnValue(button), contains: vi.fn().mockReturnValue(true) };
  return { root, button, attributes, asRoot: root as unknown as HTMLElement };
}

describe('demonstration clicks stay inside the training sandbox', () => {
  it('queries only its root and clicks the explicitly allowed matching button once', () => {
    const { root, button, asRoot } = sandbox();
    expect(clickTutorialDemoTarget(asRoot, 'tutorial-step-one', 'step-one')).toBe(true);
    expect(root.querySelector).toHaveBeenCalledExactlyOnceWith('[data-tutorial-target="tutorial-step-one"]');
    expect(root.contains).toHaveBeenCalledExactlyOnceWith(button);
    expect(button.click).toHaveBeenCalledTimes(1);
  });

  it.each(['outside', 'submit', 'link', 'wrong-action', 'unapproved', 'disabled', 'aria-disabled', 'hidden', 'hidden-parent', 'detached'])('does not click a %s target', (scenario) => {
    const { root, button, attributes, asRoot } = sandbox();
    if (scenario === 'outside') root.contains.mockReturnValue(false);
    if (scenario === 'submit') attributes.type = 'submit';
    if (scenario === 'link') button.tagName = 'A';
    if (scenario === 'wrong-action') attributes['data-tutorial-action'] = 'another-step';
    if (scenario === 'unapproved') delete attributes['data-tutorial-demo-safe'];
    if (scenario === 'disabled') button.disabled = true;
    if (scenario === 'aria-disabled') attributes['aria-disabled'] = 'true';
    if (scenario === 'hidden') button.hidden = true;
    if (scenario === 'hidden-parent') button.closest.mockReturnValue({});
    if (scenario === 'detached') root.isConnected = false;
    expect(clickTutorialDemoTarget(asRoot, 'tutorial-step-one', 'step-one')).toBe(false);
    expect(button.click).not.toHaveBeenCalled();
  });

  it('rejects selector injection, missing roots and missing targets', () => {
    const { root, asRoot } = sandbox();
    expect(findTutorialDemoTarget(asRoot, '"] button', 'step-one')).toBeNull();
    expect(root.querySelector).not.toHaveBeenCalled();
    expect(findTutorialDemoTarget(null, 'tutorial-step-one', 'step-one')).toBeNull();
    root.querySelector.mockReturnValue(null);
    expect(clickTutorialDemoTarget(asRoot, 'tutorial-step-one', 'step-one')).toBe(false);
  });
});
