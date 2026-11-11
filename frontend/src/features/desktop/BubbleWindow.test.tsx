import { act, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BubbleWindow from './BubbleWindow';

const bridge = vi.hoisted(() => ({
  saveBubblePosition: vi.fn(),
}));

// 音量在真实设备上来自麦克风；测试直接推动订阅回调，
// 断言的是「电平写进了 CSS 变量」而不是整条音频链路。
const mic = vi.hoisted(() => {
  const listeners = new Set<(level: number) => void>();
  return {
    subscribeMicLevel: vi.fn((listener: (level: number) => void) => {
      listener(0);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit: (level: number) => {
      for (const listener of listeners) listener(level);
    },
    reset: () => listeners.clear(),
  };
});

vi.mock('@/services/bridge', () => bridge);
vi.mock('@/services/recorder', () => ({
  subscribeMicLevel: mic.subscribeMicLevel,
}));

type Props = Parameters<typeof BubbleWindow>[0];

function renderBubble(overrides: Partial<Props> = {}) {
  const props: Props = {
    isArming: false,
    isRecording: false,
    isProcessing: false,
    flash: '',
    onToggle: vi.fn(),
    onExpand: vi.fn(),
    ...overrides,
  };
  const view = render(<BubbleWindow {...props} />);
  return { ...view, props };
}

function bubbleButton() {
  return screen.getByRole('button');
}

// 音量变量挂在外壳上：球体与音晕共用它，音晕才不会跟着球体缩放。
function bubbleShell() {
  return screen.getByRole('main');
}

describe('BubbleWindow', () => {
  beforeEach(() => {
    bridge.saveBubblePosition.mockReset();
    mic.subscribeMicLevel.mockClear();
    mic.reset();
  });

  it('待录音时只显示开始录音，不出现停止图标', () => {
    renderBubble();
    expect(
      screen.getByRole('button', { name: '开始录音，双击展开主窗口' }),
    ).toBeVisible();
    expect(screen.queryByRole('button', { name: '结束录音' })).toBeNull();
  });

  it('开启麦克风时说明可以取消，且不显示录音中的红色状态', () => {
    renderBubble({ isArming: true });
    expect(bubbleButton().getAttribute('aria-label')).toBe(
      '正在开启麦克风，单击取消',
    );
    expect(bubbleShell()).toHaveAttribute('data-state', 'arming');
    expect(bubbleButton().className).not.toContain('recording');
  });

  it('录音中把麦克风电平写进 CSS 变量，卸载时退订', () => {
    const { unmount } = renderBubble({ isRecording: true });
    expect(bubbleButton().getAttribute('aria-label')).toBe('结束录音');
    expect(bubbleShell()).toHaveAttribute('data-state', 'recording');
    // 初始电平来自订阅时的立即回调。
    expect(bubbleShell().style.getPropertyValue('--mic-level')).toBe('0.000');

    act(() => mic.emit(0.72));
    expect(bubbleShell().style.getPropertyValue('--mic-level')).toBe('0.720');

    unmount();
    // 退订之后没有残留监听：再推电平不会有任何写操作。
    expect(() => mic.emit(0.3)).not.toThrow();
  });

  it('整理中禁用点击并显示进度文案', () => {
    renderBubble({ isProcessing: true });
    expect(
      screen.getByRole('button', { name: '正在整理文字' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });
});
