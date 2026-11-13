import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  isWindowMaximised,
  minimiseWindow,
  requestClose,
  toggleMaximiseWindow,
} from '@/services/bridge';

import WindowControls from './WindowControls';

vi.mock('@/services/bridge', () => ({
  isWindowMaximised: vi.fn(() => Promise.resolve(false)),
  minimiseWindow: vi.fn(() => Promise.resolve()),
  requestClose: vi.fn(() => Promise.resolve()),
  toggleMaximiseWindow: vi.fn(() => Promise.resolve()),
}));

describe('WindowControls', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isWindowMaximised).mockResolvedValue(false);
  });

  it('windows 上渲染最小化、最大化与关闭三个按钮', () => {
    render(<WindowControls platform="windows" />);
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最大化' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: '关闭拾语' }),
    ).toBeInTheDocument();
  });

  it('linux 同样接管窗口按钮', () => {
    render(<WindowControls platform="linux" />);
    expect(screen.getByRole('button', { name: '最小化' })).toBeInTheDocument();
  });

  it('macOS 与网页预览不画窗口按钮', () => {
    const Darwin = render(<WindowControls platform="darwin" />);
    expect(Darwin.container).toBeEmptyDOMElement();
    Darwin.unmount();

    const Web = render(<WindowControls platform="web" />);
    expect(Web.container).toBeEmptyDOMElement();
  });

  it('最小化、最大化与关闭都走桌面桥接', async () => {
    const user = userEvent.setup();
    render(<WindowControls platform="windows" />);

    await user.click(screen.getByRole('button', { name: '最小化' }));
    expect(minimiseWindow).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '最大化' }));
    expect(toggleMaximiseWindow).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: '关闭拾语' }));
    expect(requestClose).toHaveBeenCalledTimes(1);
  });

  it('窗口已最大化时按钮切成还原', async () => {
    vi.mocked(isWindowMaximised).mockResolvedValue(true);
    render(<WindowControls platform="windows" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '还原' })).toBeInTheDocument();
    });
  });
});
