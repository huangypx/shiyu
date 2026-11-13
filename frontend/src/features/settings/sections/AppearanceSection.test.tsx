import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppTheme } from '@/app/providers';
import { APPEARANCE_KEY } from '@/services/storage';
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_DESKTOP_SETTINGS, DEFAULT_SETTINGS } from '@/types/models';

import SettingsDialog from '../SettingsDialog';

describe('外观配色', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ appearance: 'dark', palette: 'celadon' });
  });

  it('切换后立即更新主窗口和已打开的弹窗，并记住经典黑白的明暗偏好', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <AppTheme>
        <SettingsDialog
          settings={DEFAULT_SETTINGS}
          desktop={DEFAULT_DESKTOP_SETTINGS}
          onChange={vi.fn()}
          onDesktopChange={vi.fn()}
          onClose={vi.fn()}
          onSave={vi.fn()}
        />
      </AppTheme>,
    );
    const root = container.querySelector('.app-theme');
    const dialogTheme = screen.getByRole('dialog').closest('.radix-themes');
    expect(root).toHaveAttribute('data-palette', 'celadon');
    expect(dialogTheme).toHaveClass('light');
    await user.click(screen.getByRole('tab', { name: /桌面行为/ }));
    expect(screen.getByRole('radio', { name: '青瓷绿 × 朱红' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: '深梅紫 × 杏桃' }));
    expect(root).toHaveAttribute('data-palette', 'plum');
    expect(document.documentElement).toHaveAttribute('data-palette', 'plum');
    expect(dialogTheme).toHaveClass('dark');
    expect(dialogTheme).toHaveAttribute('data-accent-color', 'orange');
    await user.click(screen.getByRole('radio', { name: '经典黑白' }));
    expect(dialogTheme).toHaveClass('dark');
    await user.click(screen.getByRole('radio', { name: /浅色/ }));
    expect(dialogTheme).toHaveClass('light');
    await user.click(screen.getByRole('radio', { name: '深梅紫 × 杏桃' }));
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}')).toEqual({
      palette: 'plum',
      appearance: 'light',
    });
    await user.click(screen.getByRole('radio', { name: '经典黑白' }));
    expect(dialogTheme).toHaveClass('light');
  });
});
