import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import RecorderControls from './RecorderControls';

type ControlsProps = ComponentProps<typeof RecorderControls>;

function controlsProps(overrides: Partial<ControlsProps> = {}): ControlsProps {
  return {
    isArming: false,
    isRecording: false,
    isProcessing: false,
    stage: null,
    onToggle: vi.fn(),
    ...overrides,
  };
}

function renderControls(overrides: Partial<ControlsProps> = {}) {
  return render(
    <Theme>
      <RecorderControls {...controlsProps(overrides)} />
    </Theme>,
  );
}

describe('RecorderControls', () => {
  it('待录音时只有一枚开始录音的圆形按钮', async () => {
    const onToggle = vi.fn();
    const { container } = renderControls({ onToggle });
    const user = userEvent.setup();

    const start = screen.getByRole('button', { name: '开始录音' });
    expect(start).toHaveAttribute('data-state', 'idle');
    // 栏头里没有波形，也没有状态播报：这些由始终可见的浮窗负责。
    expect(container.querySelector('[data-active]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(start);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('开启麦克风时按钮仍是麦克风，只是加一层呼吸环', async () => {
    const onToggle = vi.fn();
    renderControls({ isArming: true, onToggle });
    const user = userEvent.setup();

    const toggle = screen.getByRole('button', { name: '取消开启麦克风' });
    expect(toggle).toHaveAttribute('data-state', 'arming');
    // 采集还没确认，不能提前播报录音中，否则用户会对着没生效的麦克风说话。
    expect(screen.queryByText('录音中')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();

    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('录音中只把按钮变成红色暂停，不再重复波形、状态与取消', async () => {
    const onToggle = vi.fn();
    const { container } = renderControls({ isRecording: true, onToggle });
    const user = userEvent.setup();

    const stop = screen.getByRole('button', { name: '结束录音' });
    expect(stop).toHaveAttribute('data-state', 'recording');
    // 波形、状态文字与取消入口都在浮窗里，主窗口不重复一遍。
    expect(container.querySelector('[data-active]')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button', { name: '取消这段转写' })).toBeNull();

    await user.click(stop);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('转写中按钮禁用并显示旋转图标，可访问名称说明在等识别', () => {
    renderControls({ isProcessing: true, stage: 'transcribe' });

    const button = screen.getByRole('button', { name: '转写中' });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('data-state', 'processing');
    // 耗时不再显示在栏头：浮窗里已经有进度反馈。
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('整理中说明在等整理，而不是识别', () => {
    renderControls({ isProcessing: true, stage: 'organize' });

    expect(screen.getByRole('button', { name: '整理中' })).toBeDisabled();
    expect(screen.queryByText('录音中')).toBeNull();
  });
});
