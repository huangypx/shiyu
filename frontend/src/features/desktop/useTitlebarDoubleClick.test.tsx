import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { toggleMaximiseWindow } from '@/services/bridge';

import { useTitlebarDoubleClick } from './useTitlebarDoubleClick';

vi.mock('@/services/bridge', () => ({
  toggleMaximiseWindow: vi.fn(() => Promise.resolve()),
}));

// 顶带、侧栏头部和窗口按钮共用同一个处理函数，用一个小夹具
// 覆盖三种目标：空白处、普通按钮、窗口按钮容器。
function Band({ enabled }: { enabled?: boolean }) {
  const onDoubleClick = useTitlebarDoubleClick(enabled);
  return (
    <div>
      <div data-testid="band" onDoubleClick={onDoubleClick}>
        空白
      </div>
      <button type="button" onDoubleClick={onDoubleClick}>
        按钮
      </button>
      <div data-window-controls onDoubleClick={onDoubleClick}>
        控件
      </div>
    </div>
  );
}

describe('useTitlebarDoubleClick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('双击顶带空白处最大化窗口', async () => {
    render(<Band />);
    await userEvent.setup().dblClick(screen.getByTestId('band'));
    expect(toggleMaximiseWindow).toHaveBeenCalledTimes(1);
  });

  it('双击按钮不改变窗口状态', async () => {
    const user = userEvent.setup();
    render(<Band />);
    await user.dblClick(screen.getByRole('button', { name: '按钮' }));
    expect(toggleMaximiseWindow).not.toHaveBeenCalled();
  });

  it('双击窗口按钮不改变窗口状态', async () => {
    const user = userEvent.setup();
    render(<Band />);
    await user.dblClick(screen.getByText('控件'));
    expect(toggleMaximiseWindow).not.toHaveBeenCalled();
  });

  it('关闭后不再接管双击', async () => {
    render(<Band enabled={false} />);
    await userEvent.setup().dblClick(screen.getByTestId('band'));
    expect(toggleMaximiseWindow).not.toHaveBeenCalled();
  });
});
