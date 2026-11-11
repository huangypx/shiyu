import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/store/sessionStore';

import RecordPage from './RecordPage';

vi.mock('@/services/bridge', () => ({
  startRecording: vi.fn(),
  stopRecording: vi.fn(),
  transcribe: vi.fn(),
  organize: vi.fn(),
  pasteText: vi.fn(),
  copyText: vi.fn(),
  loadCalls: vi.fn().mockResolvedValue(undefined),
  clearCalls: vi.fn(),
  setActivePreset: vi.fn(),
  blobToDataUrl: vi.fn(),
  subscribeDesktopHotkey: vi.fn(() => () => undefined),
  subscribeAsrPartial: vi.fn(() => () => undefined),
  cancelTranscriptionRequest: vi.fn(),
  TransferCancelled: class TransferCancelled extends Error {},
}));

vi.mock('@/services/recorder', () => ({
  startWavRecording: vi.fn(),
  // 录音卡订阅音量：测试里只需提供一个可退订的空实现。
  subscribeMicLevel: vi.fn(() => () => undefined),
}));

describe('RecordPage', () => {
  beforeEach(() => {
    useSessionStore.setState({
      status: 'idle',
      transcript: '',
      organized: '',
      metrics: {},
      elapsedMs: 0,
      copied: false,
    });
  });

  it('渲染录音入口与两个编辑面板', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(
      screen.getByRole('heading', { name: '今天想记录什么？' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible();
    expect(screen.getByRole('region', { name: '原始记录' })).toBeVisible();
    expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible();
  });

  it('没有原始文本时整理按钮不可用', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(screen.getByRole('button', { name: '整理文字' })).toBeDisabled();
  });

  it('结果面板可以切换整理预设', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    // 选择器显示当前生效预设的名称，默认是内置的「默认整理」。
    const picker = screen.getByRole('combobox', { name: '整理预设' });
    expect(picker).toHaveTextContent('默认整理');
  });

  it('录音中显示结束录音的入口', () => {
    useSessionStore.setState({ status: 'recording' });

    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(screen.getByRole('button', { name: '结束录音' })).toBeVisible();
  });

  it('开启麦克风期间提供取消入口，并说明还没开始录', () => {
    useSessionStore.setState({ status: 'arming' });

    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(
      screen.getByRole('button', { name: '取消开启麦克风' }),
    ).toBeVisible();
    // 采集未确认时不能出现「正在聆听」，否则用户会提前开口。
    expect(screen.queryByText('正在聆听')).toBeNull();
    expect(screen.getByText('开启麦克风')).toBeVisible();
  });

  it('录音中提供「取消这段转写」，待录音时没有', () => {
    const { unmount } = render(
      <Theme>
        <RecordPage />
      </Theme>,
    );
    expect(screen.queryByRole('button', { name: '取消这段转写' })).toBeNull();
    unmount();

    useSessionStore.setState({ status: 'recording' });
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );
    expect(screen.getByRole('button', { name: '取消这段转写' })).toBeVisible();
  });
});
