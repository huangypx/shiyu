import { Theme } from '@radix-ui/themes';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useSessionStore } from '@/store/sessionStore';

import RecordPage from './RecordPage';

describe('RecordPage', () => {
  beforeEach(() => {
    useSessionStore.setState({
      transcript: '',
      organized: '',
      status: 'idle',
      copied: false,
    });
  });

  it('同时展示原文和结果，不重复显示工具栏的录音入口', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );
    expect(screen.getByRole('region', { name: '原文' })).toBeVisible();
    expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '开始录音' })).toBeNull();
    expect(screen.getByRole('button', { name: '复制结果' })).toBeDisabled();
  });

  it('接收会话更新，编辑即写回本次原文', () => {
    render(
      <Theme>
        <RecordPage />
      </Theme>,
    );
    act(() =>
      useSessionStore.setState({
        transcript: '明天十点啊开会',
        organized: '明天十点开会。',
      }),
    );
    const source = screen.getByRole('textbox', { name: '原文' });
    expect(source).toHaveValue('明天十点啊开会');
    expect(screen.getByText('明天十点开会。')).toBeVisible();
    fireEvent.change(source, { target: { value: '明天九点开会' } });
    expect(useSessionStore.getState().transcript).toBe('明天九点开会');
  });
});
