import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RECORD_SPLIT_KEY } from '@/services/storage';

import { useUiStore } from './uiStore';

describe('uiStore 记录页两栏比例', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ recordSplit: 0.5, settingsOpen: false });
  });

  it('两栏比例被夹在 28%–72%，停下来才写本地存储', () => {
    vi.useFakeTimers();

    useUiStore.getState().setRecordSplit(0.9);
    expect(useUiStore.getState().recordSplit).toBe(0.72);
    // 拖动中不落盘，避免每帧都写 localStorage。
    expect(localStorage.getItem(RECORD_SPLIT_KEY)).toBeNull();

    vi.advanceTimersByTime(200);
    expect(JSON.parse(localStorage.getItem(RECORD_SPLIT_KEY) ?? '{}')).toEqual({
      split: 0.72,
    });
    vi.useRealTimers();
  });

  it('偏好设置弹窗只有开与关两个状态', () => {
    useUiStore.getState().openSettings();
    expect(useUiStore.getState().settingsOpen).toBe(true);

    useUiStore.getState().closeSettings();
    expect(useUiStore.getState().settingsOpen).toBe(false);
  });
});
