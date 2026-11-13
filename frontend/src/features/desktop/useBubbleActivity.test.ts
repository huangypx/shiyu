import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setBubbleActivity } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

import { useBubbleActivity } from './useBubbleActivity';

vi.mock('@/services/bridge', () => ({ setBubbleActivity: vi.fn() }));

describe('浮动窗口显隐', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    useDesktopStore.getState().setRuntime({ mode: 'bubble' });
    useSessionStore.setState({
      status: 'idle',
      bubbleResult: '',
      organized: '',
    });
    useUiStore.setState({ notice: null });
  });
  afterEach(() => vi.useRealTimers());

  it('录音和整理持续显示，结果显示五秒且只清除浮动预览', async () => {
    const { result } = renderHook(useBubbleActivity);
    expect(result.current).toBe(false);
    for (const status of ['arming', 'recording', 'processing'] as const) {
      act(() => useSessionStore.getState().setStatus(status));
      await act(() => vi.advanceTimersByTimeAsync(8000));
      expect(result.current).toBe(true);
      expect(setBubbleActivity).toHaveBeenLastCalledWith(true);
    }
    act(() =>
      useSessionStore.setState({
        status: 'idle',
        organized: '全文',
        bubbleResult: '全文',
      }),
    );
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(result.current).toBe(true);
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current).toBe(false);
    expect(setBubbleActivity).toHaveBeenLastCalledWith(false);
    expect(useSessionStore.getState().organized).toBe('全文');
  });

  it('新通知单独计时，过期时不能关掉进行中的录音', async () => {
    const { result } = renderHook(useBubbleActivity);
    act(() => useUiStore.getState().notify('第一条'));
    await act(() => vi.advanceTimersByTimeAsync(4000));
    act(() => useUiStore.getState().notify('第二条', 'error'));
    await act(() => vi.advanceTimersByTimeAsync(4999));
    expect(useUiStore.getState().notice?.message).toBe('第二条');
    act(() => useSessionStore.getState().setStatus('recording'));
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(useUiStore.getState().notice).toBeNull();
    expect(result.current).toBe(true);
  });

  it('展开主窗口后结果继续计时，过期时保留主窗口', async () => {
    useSessionStore.setState({ bubbleResult: '结果' });
    renderHook(useBubbleActivity);
    await act(() => vi.advanceTimersByTimeAsync(2000));
    act(() => useDesktopStore.getState().setRuntime({ mode: 'main' }));
    await act(() => vi.advanceTimersByTimeAsync(3000));
    expect(useSessionStore.getState().bubbleResult).toBe('');
    expect(setBubbleActivity).not.toHaveBeenCalledWith(false);
  });
});
