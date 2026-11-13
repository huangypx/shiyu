import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveWindowClose } from '@/services/bridge';

import CloseDialog from './CloseDialog';

vi.mock('@/services/bridge', () => ({
  resolveWindowClose: vi.fn(() => Promise.resolve()),
}));

function renderDialog() {
  return render(
    <Theme>
      <CloseDialog />
    </Theme>,
  );
}

describe('CloseDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('把默认动作说成收进悬浮球，勾选与按钮同排', () => {
    renderDialog();
    expect(
      screen.getByRole('heading', { name: '关闭拾语' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/收进悬浮球继续运行/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '收进悬浮球' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '直接退出' }),
    ).toBeInTheDocument();
    // 勾选与两枚按钮落在同一个行容器里，视觉上才是一行。
    const row = document.querySelector('[data-close-actions]');
    expect(row).toContainElement(
      screen.getByRole('checkbox', { name: '记住本次选择' }),
    );
    expect(row).toContainElement(
      screen.getByRole('button', { name: '直接退出' }),
    );
    expect(row).toContainElement(
      screen.getByRole('button', { name: '收进悬浮球' }),
    );
  });

  it('收进悬浮球提交 background', async () => {
    renderDialog();
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: '收进悬浮球' }));
    expect(resolveWindowClose).toHaveBeenCalledWith('background', false);
  });

  it('勾选记住后把偏好一起提交', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: '记住本次选择' }));
    await user.click(screen.getByRole('button', { name: '收进悬浮球' }));
    expect(resolveWindowClose).toHaveBeenCalledWith('background', true);
  });

  it('直接退出与取消都不写偏好', async () => {
    renderDialog();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '直接退出' }));
    expect(resolveWindowClose).toHaveBeenCalledWith('quit', false);
    await user.click(screen.getByRole('button', { name: '取消关闭' }));
    expect(resolveWindowClose).toHaveBeenCalledWith('cancel', false);
  });
});
