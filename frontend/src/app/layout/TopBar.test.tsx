import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { enterBubble, toggleMaximiseWindow } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

import TopBar from './TopBar';

// 顶栏通过 useRecordingActions / useWindowActions 间接依赖桌面桥接，
// 这里只关心导航、设置与窗口操作，桥接全部替换成空实现。
vi.mock('@/services/bridge', () => ({
  cancelDesktopTranscription: vi.fn(),
  cancelTranscriptionRequest: vi.fn(),
  copyText: vi.fn(),
  loadCalls: vi.fn(),
  organize: vi.fn(),
  organizeSession: vi.fn(),
  pasteText: vi.fn(),
  publishSession: vi.fn().mockResolvedValue(undefined),
  subscribeAsrPartial: vi.fn(() => () => undefined),
  subscribeDesktopMicLevel: vi.fn(() => () => undefined),
  takeMainCommands: vi.fn(() => Promise.resolve([])),
  toggleDesktopRecording: vi.fn(),
  transcribe: vi.fn(),
  TransferCancelled: class TransferCancelled extends Error {},
  enterBubble: vi.fn(() => Promise.resolve()),
  showMainWindow: vi.fn(),
  openSettingsWindow: vi.fn(),
  isWindowMaximised: vi.fn(() => Promise.resolve(false)),
  minimiseWindow: vi.fn(() => Promise.resolve()),
  quitApp: vi.fn(() => Promise.resolve()),
  toggleMaximiseWindow: vi.fn(() => Promise.resolve()),
}));

function RouteProbe() {
  return <output aria-label="当前页面">{useLocation().pathname}</output>;
}

function renderTopBar(initialEntries: string[] = ['/']) {
  return render(
    <Theme>
      <MemoryRouter initialEntries={initialEntries}>
        <TopBar />
        <RouteProbe />
      </MemoryRouter>
    </Theme>,
  );
}

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useUiStore.setState({ settingsOpen: false });
    useSessionStore.setState({
      status: 'idle',
      stage: null,
      transcript: '',
      organized: '',
    });
    // 窗口按钮只在桌面平台出现：默认回到网页预览，单个用例再改成
    // windows / darwin，避免用例之间互相污染。
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'web' },
    }));
  });

  it('品牌、历史、调用记录和设置都在顶栏', async () => {
    const user = userEvent.setup();
    renderTopBar();

    await user.click(screen.getByRole('link', { name: '历史记录' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/history');

    await user.click(screen.getByRole('link', { name: '调用记录' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/calls');

    await user.click(screen.getByRole('link', { name: '拾语，返回编辑器' }));
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/');

    await user.click(screen.getByRole('button', { name: '偏好设置' }));
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });

  it('新建记录清空草稿并回到记录页', async () => {
    useSessionStore.setState({ transcript: '记一下明天的安排' });
    renderTopBar(['/history']);

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '新建记录' }));

    expect(useSessionStore.getState().transcript).toBe('');
    expect(screen.getByLabelText('当前页面')).toHaveTextContent('/');
  });

  it('右上角保留收进悬浮球', async () => {
    renderTopBar();

    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '收进悬浮球' }));

    expect(enterBubble).toHaveBeenCalledTimes(1);
  });

  it('不再渲染旧的菜单开关与面包屑', () => {
    renderTopBar();

    expect(screen.queryByRole('button', { name: '打开菜单' })).toBeNull();
    expect(screen.queryByText('工作区')).toBeNull();
  });

  it('windows 上顶带右端接管窗口按钮', () => {
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'windows' },
    }));
    renderTopBar();

    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '关闭拾语' }),
    ).toBeInTheDocument();
  });

  it('macOS 不重复画窗口按钮', () => {
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'darwin' },
    }));
    renderTopBar();

    expect(screen.queryByRole('button', { name: '最小化' })).toBeNull();
  });

  it('双击顶带空白处最大化窗口', async () => {
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'windows' },
    }));
    renderTopBar();

    await userEvent.setup().dblClick(screen.getByRole('banner'));
    expect(toggleMaximiseWindow).toHaveBeenCalledTimes(1);
  });
});
