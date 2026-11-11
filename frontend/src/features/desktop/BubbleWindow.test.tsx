import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function clickBubble() {
  const button = bubbleButton();
  fireEvent.mouseDown(button, { button: 0, screenX: 100, screenY: 100 });
  fireEvent.mouseUp(button, { button: 0, screenX: 100, screenY: 100 });
}

describe('BubbleWindow', () => {
  beforeEach(() => {
    bridge.saveBubblePosition.mockReset();
    mic.subscribeMicLevel.mockClear();
    mic.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('双击只展开主窗口，不误触录音', () => {
    vi.useFakeTimers();
    const { props } = renderBubble();

    clickBubble();
    // 第一下轻点后暂时关掉原生拖拽区，第二下才不会落到
    // macOS 的标题栏双击手势上。
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    void act(() => vi.advanceTimersByTime(120));
    clickBubble();

    expect(props.onExpand).toHaveBeenCalledTimes(1);
    expect(props.onToggle).not.toHaveBeenCalled();

    void act(() => vi.advanceTimersByTime(500));
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('单击仍在双击窗口结束后切换录音，并恢复拖拽', () => {
    vi.useFakeTimers();
    const { props } = renderBubble();

    clickBubble();
    void act(() => vi.advanceTimersByTime(259));
    expect(props.onToggle).not.toHaveBeenCalled();

    void act(() => vi.advanceTimersByTime(1));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    void act(() => vi.advanceTimersByTime(500));
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('右键菜单关闭前的残留按压不会启动原生拖拽', () => {
    renderBubble();
    fireEvent.contextMenu(bubbleButton());
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    // 菜单跟踪会吞掉关闭菜单时的 mousedown，页面只剩带左键状态的
    // mousemove；Wails 会把它合成一次拖拽。
    fireEvent.mouseDown(bubbleButton(), {
      button: 0,
      buttons: 1,
      screenX: 100,
      screenY: 100,
    });
    fireEvent.mouseMove(bubbleButton(), {
      buttons: 1,
      screenX: 130,
      screenY: 110,
    });
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    fireEvent.mouseUp(bubbleButton(), {
      button: 0,
      buttons: 0,
      screenX: 130,
      screenY: 110,
    });
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('菜单关闭后没有按键的移动会恢复拖拽区', () => {
    vi.useFakeTimers();
    renderBubble();
    fireEvent.contextMenu(bubbleButton());
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    // 右键到菜单真正打开之间的移动不能解除守卫。
    fireEvent.mouseMove(window, { buttons: 0 });
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    void act(() => vi.advanceTimersByTime(120));
    fireEvent.mouseMove(window, { buttons: 0 });
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('点击其他应用关闭菜单时，失焦会恢复拖拽区', () => {
    renderBubble();
    fireEvent.contextMenu(bubbleButton());
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    fireEvent(window, new Event('blur'));
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('关闭菜单的点击不会开始录音，恢复后单击照常生效', () => {
    vi.useFakeTimers();
    const { props } = renderBubble();
    fireEvent.contextMenu(bubbleButton());

    clickBubble();
    // 关闭菜单的 mouseup 会恢复拖拽区，但这次按压本身被忽略。
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
    void act(() => vi.advanceTimersByTime(300));
    expect(props.onToggle).not.toHaveBeenCalled();

    clickBubble();
    void act(() => vi.advanceTimersByTime(300));
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});
