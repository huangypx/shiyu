import { Theme } from '@radix-ui/themes';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings/settingsStore';
import { resolveWindowClose } from '@/services/bridge';

import CloseDialog from './CloseDialog';

vi.mock('@/services/bridge', () => ({ resolveWindowClose: vi.fn() }));

describe('关闭窗口', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    useSettingsStore.getState().patchDesktop({ closeAction: 'ask' });
    render(
      <Theme>
        <CloseDialog />
      </Theme>,
    );
  });

  it('默认不记住，下一次仍询问', async () => {
    expect(screen.getByRole('checkbox')).not.toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: '后台运行' }));
    await waitFor(() =>
      expect(resolveWindowClose).toHaveBeenCalledWith('background', false),
    );
    expect(useSettingsStore.getState().desktop.closeAction).toBe('ask');
  });

  it.each([
    ['后台运行', 'background'],
    ['直接退出', 'quit'],
  ] as const)('可记住「%s」', async (name, action) => {
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() =>
      expect(useSettingsStore.getState().desktop.closeAction).toBe(action),
    );
    expect(resolveWindowClose).toHaveBeenCalledWith(action, true);
  });

  it('取消关闭时忽略复选框', async () => {
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: '取消关闭' }));
    await waitFor(() =>
      expect(resolveWindowClose).toHaveBeenCalledWith('cancel', false),
    );
    expect(useSettingsStore.getState().desktop.closeAction).toBe('ask');
  });
});
