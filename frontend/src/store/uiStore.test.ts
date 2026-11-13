import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RECORD_SPLIT_KEY, SIDEBAR_KEY } from '@/services/storage';

import { useUiStore } from './uiStore';

describe('uiStore 侧栏折叠状态', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarCollapsed: false, sidebarOpen: false });
  });

  it('切换折叠并把结果写进本地存储', () => {
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
    useUiStore.getState().toggleSidebarCollapsed();
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    expect(JSON.parse(localStorage.getItem(SIDEBAR_KEY) ?? '{}')).toEqual({
      collapsed: true,
    });
    useUiStore.getState().toggleSidebarCollapsed();
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('两栏比例被夹在 28%–72%，停下来才写本地存储', () => {
    vi.useFakeTimers();
    useUiStore.setState({ recordSplit: 0.5 });

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

  it('折叠与抽屉是两个独立状态', () => {
    useUiStore.getState().toggleSidebarCollapsed();
    useUiStore.getState().openSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });
});
