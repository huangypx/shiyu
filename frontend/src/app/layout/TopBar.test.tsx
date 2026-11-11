import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    localStorage.clear();
    useUiStore.setState({ sidebarCollapsed: false, sidebarOpen: false });
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
});
