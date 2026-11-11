import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWindowTransitionStore } from './windowTransitionStore';

const payload = {
  direction: 'shrink' as const,
  durationMs: 300,
  anchor: 'bottom-right' as const,
  from: { x: 0, y: 0, width: 1000, height: 820 },
  to: { x: 200, y: 300, width: 92, height: 92 },
};

describe('useWindowTransitionStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useWindowTransitionStore.getState().clear();
  });

  afterEach(() => {
    useWindowTransitionStore.getState().clear();
    vi.useRealTimers();
  });

  it('start 进入 running，settle 后淡出并自动清理', () => {
    useWindowTransitionStore.getState().start(payload);
    expect(useWindowTransitionStore.getState().transition?.phase).toBe(
      'running',
    );

    useWindowTransitionStore.getState().settle();
    expect(useWindowTransitionStore.getState().transition?.phase).toBe(
      'settling',
    );

    vi.advanceTimersByTime(220);
    expect(useWindowTransitionStore.getState().transition).toBeNull();
  });

  it('没有收到 state 事件时 watchdog 会撤掉遮罩', () => {
    useWindowTransitionStore.getState().start(payload);
    vi.advanceTimersByTime(payload.durationMs + 3000);
    expect(useWindowTransitionStore.getState().transition).toBeNull();
  });

  it('新的切换会清掉上一次的 settle 定时器', () => {
    useWindowTransitionStore.getState().start(payload);
    useWindowTransitionStore.getState().settle();
    useWindowTransitionStore.getState().start({
      ...payload,
      direction: 'expand',
    });

    vi.advanceTimersByTime(220);
    const current = useWindowTransitionStore.getState().transition;
    expect(current?.direction).toBe('expand');
    expect(current?.phase).toBe('running');
  });
});
