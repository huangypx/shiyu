import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import BubbleWindow from './BubbleWindow';

const bridge = vi.hoisted(() => {
  let levelListener: ((level: number) => void) | null = null;
  return {
    saveBubblePosition: vi.fn(),
    subscribeDesktopMicLevel: vi.fn((listener: (level: number) => void) => {
      levelListener = listener;
      // 订阅时立即给一次当前电平，界面不会先画一帧 0。
      listener(0);
      return () => {
        if (levelListener === listener) levelListener = null;
      };
    }),
    emitMicLevel: (level: number) => levelListener?.(level),
    resetMicLevel: () => {
      levelListener = null;
    },
  };
});

vi.mock('@/services/bridge', () => bridge);

type Props = Parameters<typeof BubbleWindow>[0];

function renderBubble(overrides: Partial<Props> = {}) {
  const props: Props = {
    isArming: false,
    isRecording: false,
    isProcessing: false,
    flash: '',
    onToggle: vi.fn(),
    onExpand: vi.fn(),
    onCancel: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
  const view = render(<BubbleWindow {...props} />);
  return { ...view, props };
}

// 工具栏加入后窗口里不再只有一个按钮：按可访问名称定位主球。
function bubbleButton() {
  return screen.getByRole('button', {
    name: /开始录音|结束录音|正在开启麦克风|正在整理文字/,
  });
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
    bridge.subscribeDesktopMicLevel.mockClear();
    bridge.resetMicLevel();
    delete window.__shiyuBubbleHover;
    delete window.__shiyuBubblePointer;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('待录音时只显示开始录音，不出现停止图标', () => {
    renderBubble();
    expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible();
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

    act(() => bridge.emitMicLevel(0.72));
    expect(bubbleShell().style.getPropertyValue('--mic-level')).toBe('0.720');

    unmount();
    // 退订之后没有残留监听：再推电平不会有任何写操作。
    expect(() => bridge.emitMicLevel(0.3)).not.toThrow();
  });

  it('整理中禁用点击并显示进度文案', () => {
    renderBubble({ isProcessing: true });
    expect(
      screen.getByRole('button', { name: '正在整理文字' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('单击立即切换录音，并在一段时间后恢复拖拽', () => {
    vi.useFakeTimers();
    const { props } = renderBubble();

    clickBubble();
    // 双击展开已经移除，单击不再需要等待双击判定。
    expect(props.onToggle).toHaveBeenCalledTimes(1);
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    void act(() => vi.advanceTimersByTime(499));
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'no-drag',
    );

    void act(() => vi.advanceTimersByTime(1));
    expect(bubbleShell().style.getPropertyValue('--wails-draggable')).toBe(
      'drag',
    );
  });

  it('连续两次点击只切换录音，不再展开主窗口', () => {
    const { props } = renderBubble();

    clickBubble();
    clickBubble();

    expect(props.onToggle).toHaveBeenCalledTimes(2);
    expect(props.onExpand).not.toHaveBeenCalled();
  });

  it('待录音时工具栏只显示展开和设置', () => {
    renderBubble();
    const toolbar = screen.getByRole('toolbar', { name: '浮动球操作' });

    expect(
      within(toolbar).getByRole('button', { name: '展开主窗口' }),
    ).toBeVisible();
    expect(
      within(toolbar).getByRole('button', { name: '打开偏好设置' }),
    ).toBeVisible();
    expect(
      within(toolbar).queryByRole('button', { name: '取消这段转写' }),
    ).toBeNull();
  });

  it('待录音时展开和设置各自触发对应动作', () => {
    const { props } = renderBubble();

    fireEvent.click(screen.getByRole('button', { name: '展开主窗口' }));
    expect(props.onExpand).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: '打开偏好设置' }));
    expect(props.onOpenSettings).toHaveBeenCalledTimes(1);

    // 工具栏按钮不冒泡成球的录音开关。
    expect(props.onToggle).not.toHaveBeenCalled();
    expect(props.onCancel).not.toHaveBeenCalled();
  });

  it('开始录音后工具栏只保留取消，展开和设置暂时隐藏', () => {
    for (const state of [
      { isArming: true },
      { isRecording: true },
      { isProcessing: true },
    ]) {
      const view = renderBubble(state);
      const toolbar = screen.getByRole('toolbar', { name: '浮动球操作' });
      const cancel = within(toolbar).getByRole('button', {
        name: '取消这段转写',
      });

      expect(cancel).toBeEnabled();
      expect(
        within(toolbar).queryByRole('button', { name: '展开主窗口' }),
      ).toBeNull();
      expect(
        within(toolbar).queryByRole('button', { name: '打开偏好设置' }),
      ).toBeNull();

      fireEvent.click(cancel);
      expect(view.props.onCancel).toHaveBeenCalledTimes(1);
      expect(view.props.onToggle).not.toHaveBeenCalled();
      view.unmount();
    }
  });

  it('原生悬停桥切换 data-hover，卸载后移除入口', () => {
    const { unmount } = renderBubble();
    expect(window.__shiyuBubbleHover).toBeTypeOf('function');

    act(() => window.__shiyuBubbleHover?.(true));
    expect(bubbleShell()).toHaveAttribute('data-hover', 'true');

    act(() => window.__shiyuBubbleHover?.(false));
    expect(bubbleShell()).not.toHaveAttribute('data-hover');

    unmount();
    expect(window.__shiyuBubbleHover).toBeUndefined();
    expect(window.__shiyuBubblePointer).toBeUndefined();
  });

  it('原生指针坐标高亮命中的按钮', () => {
    renderBubble();
    const expand = screen.getByRole('button', { name: '展开主窗口' });
    const settings = screen.getByRole('button', { name: '打开偏好设置' });
    const elementFromPoint = vi
      .spyOn(document, 'elementFromPoint')
      .mockReturnValue(expand);

    act(() => window.__shiyuBubblePointer?.(20, 109));
    expect(expand).toHaveAttribute('data-hovered', 'true');
    expect(settings).not.toHaveAttribute('data-hovered');

    elementFromPoint.mockReturnValue(settings);
    act(() => window.__shiyuBubblePointer?.(46, 109));
    expect(expand).not.toHaveAttribute('data-hovered');
    expect(settings).toHaveAttribute('data-hovered', 'true');

    elementFromPoint.mockReturnValue(null);
    act(() => window.__shiyuBubblePointer?.(46, 46));
    expect(settings).not.toHaveAttribute('data-hovered');

    elementFromPoint.mockRestore();
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
    expect(props.onToggle).toHaveBeenCalledTimes(1);
  });
});
