import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleMaximiseWindow } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

import TopBar from './TopBar';

const recording = vi.hoisted(() => ({
  toggleRecording: vi.fn(),
  cancelTranscription: vi.fn(),
  clearDraft: vi.fn(),
}));
vi.mock('@/features/recorder/useRecordingSession', () => ({
  useProcessingTimer: vi.fn(),
  useRecordingActions: () => recording,
}));
vi.mock('@/services/bridge', () => ({
  showMainWindow: vi.fn(),
  toggleDesktopMode: vi.fn(),
  isWindowMaximised: vi.fn(() => Promise.resolve(false)),
  minimiseWindow: vi.fn(() => Promise.resolve()),
  requestWindowClose: vi.fn(() => Promise.resolve()),
  toggleMaximiseWindow: vi.fn(() => Promise.resolve()),
}));

function RouteProbe() {
  return <output aria-label="当前页面">{useLocation().pathname}</output>;
}

function renderTopBar() {
  return render(
    <Theme>
      <MemoryRouter>
        <TopBar />
        <RouteProbe />
      </MemoryRouter>
    </Theme>,
  );
}

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useUiStore.setState({ settingsOpen: false });
    useSessionStore.setState({ status: 'idle', stage: null });
    useDesktopStore.getState().setRuntime({ platform: 'web' });
  });

  it('录音、新建、历史和设置从工具栏直接进入', async () => {
    const user = userEvent.setup();
    renderTopBar();
    await user.click(screen.getByRole('link', { name: '历史记录' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/history');
    await user.click(screen.getByRole('link', { name: '拾语，返回编辑器' }));
    expect(recording.clearDraft).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '开始录音' }));
    expect(recording.toggleRecording).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '新建记录' }));
    expect(recording.clearDraft).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: '偏好设置' }));
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('录音过程中可结束或取消，不能新建并清空当前录音', async () => {
    useSessionStore.setState({ status: 'recording' });
    renderTopBar();
    expect(screen.getByRole('button', { name: '新建记录' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '结束录音' })).toBeEnabled();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '取消这段转写' }));
    expect(recording.cancelTranscription).toHaveBeenCalledTimes(1);
  });

  it('处理中标明阶段并保留取消入口', () => {
    useSessionStore.setState({ status: 'processing', stage: 'organize' });
    renderTopBar();
    expect(screen.getByRole('button', { name: '整理中' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '取消这段转写' })).toBeEnabled();
  });

  it('更多操作包含调用记录和桌面悬浮球入口', async () => {
    useDesktopStore.getState().setRuntime({ platform: 'windows' });
    const user = userEvent.setup();
    renderTopBar();
    const more = screen.getByRole('button', { name: '更多操作' });
    more.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('menuitem', { name: '收进悬浮球' })).toBeVisible();
    await user.click(screen.getByRole('menuitem', { name: '调用记录' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/calls');
  });

  it('Windows 标题栏保留窗口按钮和双击最大化', async () => {
    useDesktopStore.getState().setRuntime({ platform: 'windows' });
    renderTopBar();
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '关闭窗口' }),
    ).toBeInTheDocument();
    await userEvent.setup().dblClick(screen.getByRole('banner'));
    expect(toggleMaximiseWindow).toHaveBeenCalledTimes(1);
  });

  it('macOS 使用原生窗口按钮', () => {
    useDesktopStore.getState().setRuntime({ platform: 'darwin' });
    renderTopBar();
    expect(screen.queryByRole('button', { name: '最小化' })).toBeNull();
  });
});
