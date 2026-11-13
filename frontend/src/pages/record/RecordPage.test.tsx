import { Theme } from '@radix-ui/themes';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '@/store/sessionStore';

import RecordPage from './RecordPage';

vi.mock('@/services/bridge', () => ({
  transcribe: vi.fn(),
  organize: vi.fn(),
  organizeSession: vi.fn(),
  pasteText: vi.fn(),
  copyText: vi.fn(),
  loadCalls: vi.fn().mockResolvedValue(undefined),
  clearCalls: vi.fn(),
  setActivePreset: vi.fn(),
  publishSession: vi.fn().mockResolvedValue(undefined),
  subscribeAsrPartial: vi.fn(() => () => undefined),
  subscribeDesktopMicLevel: vi.fn(() => () => undefined),
  cancelDesktopTranscription: vi.fn(),
  cancelTranscriptionRequest: vi.fn(),
  toggleDesktopRecording: vi.fn(),
  TransferCancelled: class TransferCancelled extends Error {},
}));

function renderPage() {
  return render(
    <Theme>
      <RecordPage />
    </Theme>,
  );
}

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
      copied: '',
    });
  });

  it('欢迎区与隐私说明都已经去掉', () => {
    renderPage();

    expect(
      screen.queryByRole('heading', { name: '今天想记录什么？' }),
    ).toBeNull();
    expect(screen.queryByText(/早上好|下午好|晚上好/)).toBeNull();
    // 旧版日期胶囊的形式形如「11月13日 周四」。
    expect(screen.queryByText(/\d+月\d+日/)).toBeNull();
    expect(screen.queryByText(/内容保存在本机/)).toBeNull();
    expect(screen.queryByText('准备好了吗')).toBeNull();
  });

  it('页面直接就是左右两栏，左栏可写、右栏等结果', () => {
    renderPage();

    expect(screen.getByRole('region', { name: '识别结果' })).toBeVisible();
    expect(screen.getByRole('region', { name: '转写内容' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '识别结果' })).toBeVisible();
    // 右栏也是一块可以直接写的文本域，没有内容时靠占位文案说明。
    expect(screen.getByRole('textbox', { name: '转写内容' })).toHaveAttribute(
      'placeholder',
      '还没有内容',
    );
  });

  it('录音开始后按钮变成结束录音，状态文字交给浮窗', () => {
    renderPage();
    expect(screen.getByRole('button', { name: '开始录音' })).toBeVisible();

    act(() => {
      useSessionStore.setState({ status: 'recording' });
    });

    expect(screen.getByRole('button', { name: '结束录音' })).toHaveAttribute(
      'data-state',
      'recording',
    );
    // 波形与「录音中」都在始终可见的浮窗里，主窗口不再重复。
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('在文本域里输入会写进会话状态', async () => {
    renderPage();
    const user = userEvent.setup();

    await user.type(
      screen.getByRole('textbox', { name: '识别结果' }),
      '记一下明天的安排',
    );

    expect(useSessionStore.getState().transcript).toBe('记一下明天的安排');
    expect(screen.getByText('8 字')).toBeVisible();
  });

  it('整理结果直接落在右栏，不用再翻面', () => {
    renderPage();

    act(() => {
      useSessionStore.setState({
        transcript: '记一下明天的安排',
        organized: '## 明天的安排\n- 十点开会',
      });
    });

    expect(screen.getByRole('region', { name: '转写内容' })).toBeVisible();
    // 整理结果直接写进右栏文本域，落地后就可以直接改字。
    const result = screen.getByRole('textbox', { name: '转写内容' });
    expect(result).toHaveValue('## 明天的安排\n- 十点开会');
    expect(result).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '复制转写内容' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '重新整理' })).toBeVisible();
    // 两栏左下角都有字数统计：左栏 8 字，右栏按文本域里的原文 15 字。
    expect(screen.getByText('8 字')).toBeVisible();
    expect(screen.getByText('15 字')).toBeVisible();
  });
});
