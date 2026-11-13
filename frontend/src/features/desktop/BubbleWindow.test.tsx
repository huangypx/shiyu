import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import BubbleWindow from './BubbleWindow';

const bridge = vi.hoisted(() => ({
  saveBubblePosition: vi.fn(),
  resizeBubble: vi.fn(),
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
    result: '',
    notice: null,
    copied: false,
    onCopy: vi.fn(),
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

function bubbleShell() {
  return screen.getByRole('main');
}

describe('BubbleWindow', () => {
  beforeEach(() => {
    bridge.saveBubblePosition.mockReset();
    mic.subscribeMicLevel.mockClear();
    mic.reset();
  });

  it('空闲且没有消息时隐藏整个悬浮球', () => {
    renderBubble();
    expect(screen.queryByRole('main')).toBeNull();
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
    expect(bubbleButton().querySelectorAll('i').length).toBeGreaterThan(1);
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

  it('只显示结果原文，单击复制不触发新录音', () => {
    const result = '1. 先确认时间\n2. 再发邀请';
    const { props } = renderBubble({ result });
    expect(bubbleShell().textContent).toBe(result);
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }));
    expect(props.onCopy).toHaveBeenCalledOnce();
    expect(props.onToggle).not.toHaveBeenCalled();
  });

  it('在球内显示通知原文', () => {
    renderBubble({ notice: { id: 1, message: '麦克风已断开', tone: 'error' } });
    expect(screen.getByRole('alert')).toHaveTextContent('麦克风已断开');
    expect(bubbleShell().textContent).toBe('麦克风已断开');
  });

  it('通知切到录音和整理后，胶囊只显示波形或进度，完成后只显示正文和复制按钮', () => {
    const { props, rerender } = renderBubble({
      notice: { id: 1, message: '设置已保存', tone: 'success' },
    });
    expect(bubbleShell().textContent).toBe('设置已保存');
    rerender(<BubbleWindow {...props} isRecording />);
    expect(bubbleButton().querySelectorAll('i').length).toBeGreaterThan(1);
    expect(bubbleShell().textContent).toBe('');
    rerender(<BubbleWindow {...props} isProcessing />);
    expect(bubbleShell().textContent).toBe('');
    rerender(<BubbleWindow {...props} result="明天见。" />);
    expect(bubbleShell().textContent).toBe('明天见。');
    expect(screen.getByRole('button', { name: '复制结果' })).toBeVisible();
  });
});
