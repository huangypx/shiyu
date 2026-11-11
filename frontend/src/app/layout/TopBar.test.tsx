import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleMaximiseWindow } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import TopBar from './TopBar';

// 顶栏通过 useRecordingActions / useWindowActions 间接依赖桌面桥接，
// 这里只关心顶部控件的显隐与折叠开关，桥接全部替换成空实现。
vi.mock('@/services/bridge', () => ({
  blobToDataUrl: vi.fn(),
  cancelTranscriptionRequest: vi.fn(),
  copyText: vi.fn(),
  loadCalls: vi.fn(),
  organize: vi.fn(),
  pasteText: vi.fn(),
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  subscribeAsrPartial: vi.fn(() => () => undefined),
  transcribe: vi.fn(),
  TransferCancelled: class TransferCancelled extends Error {},
  showMainWindow: vi.fn(),
  toggleDesktopMode: vi.fn(),
  isWindowMaximised: vi.fn(() => Promise.resolve(false)),
  minimiseWindow: vi.fn(() => Promise.resolve()),
  quitApp: vi.fn(() => Promise.resolve()),
  toggleMaximiseWindow: vi.fn(() => Promise.resolve()),
}));

vi.mock('@/services/recorder', () => ({
  startWavRecording: vi.fn(),
  subscribeMicLevel: vi.fn(() => () => undefined),
}));

function renderTopBar() {
  return render(
    <Theme>
      <MemoryRouter>
        <TopBar />
      </MemoryRouter>
    </Theme>,
  );
}

describe('TopBar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useUiStore.setState({ sidebarCollapsed: false, sidebarOpen: false });
    // 窗口按钮只在桌面平台出现：默认回到网页预览，单个用例再改成
    // windows / darwin，避免用例之间互相污染。
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'web' },
    }));
  });

  it('侧栏展开时不在顶栏重复放侧栏操作', () => {
    renderTopBar();
    expect(screen.queryByRole('button', { name: '展开侧栏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '新建记录' })).toBeNull();
    expect(screen.getByText('工作区')).toBeInTheDocument();
  });

  it('侧栏收起后顶栏接管展开与新建', async () => {
    useUiStore.setState({ sidebarCollapsed: true });
    renderTopBar();
    const expand = screen.getByRole('button', { name: '展开侧栏' });
    expect(
      screen.getByRole('button', { name: '新建记录' }),
    ).toBeInTheDocument();
    await userEvent.setup().click(expand);
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
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
    await userEvent.setup().dblClick(screen.getByText('工作区'));
    expect(toggleMaximiseWindow).toHaveBeenCalledTimes(1);
  });
});
