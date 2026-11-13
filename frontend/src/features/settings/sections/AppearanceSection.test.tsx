import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppTheme } from '@/app/providers';
import { APPEARANCE_KEY } from '@/services/storage';
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_DESKTOP_SETTINGS, DEFAULT_SETTINGS } from '@/types/models';

import SettingsDialog from '../SettingsDialog';

function renderDialog() {
  return render(
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
}

describe('外观设置', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ appearance: 'system', palette: 'mono' });
  });

  it('切换主题色会同时更新根容器、弹层配色与本地偏好', async () => {
    const user = userEvent.setup();
    const { container } = renderDialog();
    const root = container.querySelector('.app-theme');
    // Radix 弹层渲染在 body 下，是另一棵 .radix-themes；这里取的正是
    // 那棵树的根，用来确认主题色和固定明暗都传到了 portal 里。
    const dialogTheme = screen.getByRole('dialog').closest('.radix-themes');

    expect(root).toHaveAttribute('data-palette', 'mono');
    expect(dialogTheme).toHaveClass('light');

    // Radix 的页签会渲染一份给读屏用的隐藏文本；jsdom 不加载 CSS 时
    // 两份文本都会算进可访问名，所以用正则匹配。
    await user.click(screen.getByRole('tab', { name: /外观/ }));
    expect(screen.getByRole('radio', { name: '浅色' })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '青瓷绿 × 朱红' }));
    expect(root).toHaveAttribute('data-palette', 'celadon');
    expect(document.documentElement).toHaveAttribute('data-palette', 'celadon');
    expect(dialogTheme).toHaveClass('light');
    expect(dialogTheme).toHaveAttribute('data-accent-color', 'tomato');
    expect(dialogTheme).toHaveAttribute('data-gray-color', 'sage');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}')).toEqual({
      appearance: 'system',
      palette: 'celadon',
    });
    // 固定浅色的主题不再显示明暗切换，改成一行说明。
    expect(
      screen.queryByRole('radio', { name: '浅色' }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: '深梅紫 × 杏桃' }));
    expect(root).toHaveAttribute('data-palette', 'plum');
    expect(dialogTheme).toHaveClass('dark');
    expect(dialogTheme).toHaveAttribute('data-accent-color', 'orange');
    expect(dialogTheme).toHaveAttribute('data-gray-color', 'mauve');

    await user.click(screen.getByRole('radio', { name: '经典黑白' }));
    expect(root).toHaveAttribute('data-palette', 'mono');
    await user.click(screen.getByRole('radio', { name: '浅色' }));
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}')).toEqual({
      appearance: 'light',
      palette: 'mono',
    });
  });

  it('卸载后不把主题色留在 html 上', () => {
    const { unmount } = render(<AppTheme>{null}</AppTheme>);
    expect(document.documentElement).toHaveAttribute('data-palette', 'mono');

    unmount();
    expect(document.documentElement).not.toHaveAttribute('data-palette');
  });
});
