import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import WindowTransition from './WindowTransition';
import { useWindowTransitionStore } from './windowTransitionStore';

const shrinkPayload = {
  direction: 'shrink' as const,
  durationMs: 300,
  anchor: 'bottom-right' as const,
  from: { x: 0, y: 0, width: 1000, height: 820 },
  to: { x: 200, y: 300, width: 92, height: 92 },
};

const expandPayload = {
  direction: 'expand' as const,
  durationMs: 160,
  anchor: 'bottom-right' as const,
  from: { x: 200, y: 300, width: 92, height: 92 },
  to: { x: 0, y: 0, width: 1000, height: 820 },
};

describe('WindowTransition', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    useWindowTransitionStore.getState().clear();
  });

  afterEach(() => {
    cleanup();
    act(() => useWindowTransitionStore.getState().clear());
    vi.unstubAllGlobals();
  });

  it('没有切换时不渲染遮罩', () => {
    const { container } = render(<WindowTransition />);
    expect(container.firstChild).toBeNull();
  });

  it('收起时按方向挂载水滴并暴露锚点', () => {
    act(() => useWindowTransitionStore.getState().start(shrinkPayload));
    const { container } = render(<WindowTransition />);
    const overlay = container.querySelector('[data-window-transition]');
    expect(overlay).toHaveAttribute('data-window-transition', 'shrink');
    expect(overlay).toHaveAttribute('data-phase', 'running');
    expect(overlay?.querySelector('[data-anchor]')).toHaveAttribute(
      'data-anchor',
      'bottom-right',
    );
  });

  it('展开时只铺画布，不渲染飞行的水滴', () => {
    act(() => useWindowTransitionStore.getState().start(expandPayload));
    const { container } = render(<WindowTransition />);
    const overlay = container.querySelector('[data-window-transition]');
    expect(overlay).toHaveAttribute('data-window-transition', 'expand');
    expect(overlay?.querySelector('[data-anchor]')).toBeNull();
  });
});
