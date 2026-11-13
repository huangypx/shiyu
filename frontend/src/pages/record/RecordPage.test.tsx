import { Theme } from '@radix-ui/themes';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/store/sessionStore';

import RecordPage from './RecordPage';

vi.mock('@/services/bridge', () => ({
  startRecording: vi.fn(),
  transcribe: vi.fn(),
  organize: vi.fn(),
  pasteText: vi.fn(),
  copyText: vi.fn(),
  loadCalls: vi.fn().mockResolvedValue(undefined),
  clearCalls: vi.fn(),
  setActivePreset: vi.fn(),
  blobToDataUrl: vi.fn(),
  subscribeAsrPartial: vi.fn(() => () => undefined),
  subscribeDesktopMicLevel: vi.fn(() => () => undefined),
  cancelDesktopTranscription: vi.fn(),
  cancelTranscriptionRequest: vi.fn(),
  toggleDesktopRecording: vi.fn(),
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
      stage: null,
      transcript: '',
      organized: '',
      metrics: {},
      stageStartedAt: 0,
      revision: 0,
      elapsedMs: 0,
      copied: false,
    });
  });

  it('渲染录音入口与记录卡的原始记录一面', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(
      screen.getByRole('heading', { name: '今天想记录什么？' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible();
    // 记录卡只有一面在 DOM 里：没有结果时不渲染整理结果。
    expect(screen.getByRole('region', { name: '原始记录' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '整理结果' })).toBeNull();
  });

  it('整理结果落地后卡片翻到整理结果一面', async () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    act(() => {
      useSessionStore.setState({ transcript: '记一下明天的安排' });
    });

    act(() => {
      useSessionStore.setState({ organized: '## 明天的安排\n- 十点开会' });
    });

    // 翻面先等退出动画结束才换面，新面还要淡入，断言要轮询。
    await waitFor(
      () =>
        expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible(),
      { timeout: 3000 },
    );
    expect(screen.queryByRole('region', { name: '原始记录' })).toBeNull();
  });

  it('没有原始文本时整理按钮不可用', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );

    expect(screen.getByRole('button', { name: '整理文字' })).toBeDisabled();
  });

  it('记录卡上可以切换整理预设', () => {
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
