import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import OverlayWindow from './OverlayWindow';

// 音量在真实设备上来自麦克风；测试直接推动订阅回调，断言的是
// 「电平写进了 CSS 变量」而不是整条音频链路，与浮动球测试一致。
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

vi.mock('@/services/recorder', () => ({
  subscribeMicLevel: mic.subscribeMicLevel,
}));

type Props = Parameters<typeof OverlayWindow>[0];

function renderOverlay(overrides: Partial<Props> = {}) {
  const props: Props = {
    isArming: false,
    isRecording: false,
    isProcessing: false,
    flash: '',
    onCancel: vi.fn(),
    ...overrides,
  };
  const view = render(<OverlayWindow {...props} />);
  return { ...view, props };
}

// 音量变量挂在外壳上，波形竖条读它起伏。
function shell() {
  return screen.getByRole('main');
}

describe('OverlayWindow', () => {
  beforeEach(() => {
    mic.subscribeMicLevel.mockClear();
    mic.reset();
  });

  it('开启麦克风时是胶囊态，复用 17 根波形竖条且可取消', () => {
    const { container, props } = renderOverlay({ isArming: true });
    expect(shell()).toHaveAttribute('data-state', 'arming');
    expect(container.querySelectorAll('i')).toHaveLength(17);

    const cancel = screen.getByRole('button', { name: '取消这段转写' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(props.onCancel).toHaveBeenCalledTimes(1);
  });

  it('录音中把麦克风电平写进 CSS 变量，取消钮仍在', () => {
    renderOverlay({ isRecording: true });
    expect(shell()).toHaveAttribute('data-state', 'recording');
    // 初始电平来自订阅时的立即回调。
    expect(shell().style.getPropertyValue('--mic-level')).toBe('0.000');

    act(() => mic.emit(0.6));
    expect(shell().style.getPropertyValue('--mic-level')).toBe('0.600');
    expect(screen.getByRole('button', { name: '取消这段转写' })).toBeEnabled();
  });

  it('整理中收成圆，撤掉取消钮', () => {
    renderOverlay({ isProcessing: true });
    expect(shell()).toHaveAttribute('data-state', 'processing');
    expect(screen.queryByRole('button', { name: '取消这段转写' })).toBeNull();
  });

  it('完成后 idle 圆闪示成功，不再可取消', () => {
    renderOverlay({ flash: 'success' });
    expect(shell()).toHaveAttribute('data-state', 'idle');
    expect(shell()).toHaveAttribute('data-flash', 'success');
    expect(screen.queryByRole('button', { name: '取消这段转写' })).toBeNull();
  });

  it('出错时 idle 圆闪示失败', () => {
    renderOverlay({ flash: 'error' });
    expect(shell()).toHaveAttribute('data-state', 'idle');
    expect(shell()).toHaveAttribute('data-flash', 'error');
  });

  it('待录音 idle 不带闪示属性，残留勾叉不会漏进来', () => {
    renderOverlay();
    expect(shell()).toHaveAttribute('data-state', 'idle');
    expect(shell()).not.toHaveAttribute('data-flash');
  });

  it('卸载后退订音量，再推电平不会有任何写操作', () => {
    const { unmount } = renderOverlay({ isRecording: true });
    unmount();
    expect(() => mic.emit(0.3)).not.toThrow();
  });
});
