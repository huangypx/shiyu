import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APPEARANCE_KEY, RECORD_SPLIT_KEY } from '@/services/storage';

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

// 主题色与明暗偏好只在模块初始化时读一次 localStorage，测启动路径
// 必须重置模块图后重新导入，否则拿到的是文件顶部那个已初始化的单例。
async function loadFreshUiStore() {
  vi.resetModules();
  return import('./uiStore');
}

describe('uiStore 外观偏好', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ appearance: 'system', palette: 'mono' });
  });

  it('默认主题色是经典黑白', async () => {
    const { useUiStore: fresh } = await loadFreshUiStore();
    expect(fresh.getState().appearance).toBe('system');
    expect(fresh.getState().palette).toBe('mono');
  });

  it('旧版本只存 appearance 时保留明暗偏好，未知主题色回落经典黑白', async () => {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ appearance: 'dark' }),
    );
    const legacy = await loadFreshUiStore();
    expect(legacy.useUiStore.getState().appearance).toBe('dark');
    expect(legacy.useUiStore.getState().palette).toBe('mono');

    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ appearance: 'dark', palette: 'neon' }),
    );
    const dirty = await loadFreshUiStore();
    expect(dirty.useUiStore.getState().appearance).toBe('dark');
    expect(dirty.useUiStore.getState().palette).toBe('mono');
  });

  it('切换主题色与明暗模式时合并写入同一个偏好对象', () => {
    useUiStore.getState().setPalette('plum');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}')).toEqual({
      appearance: 'system',
      palette: 'plum',
    });

    useUiStore.getState().setAppearance('light');
    expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY) ?? '{}')).toEqual({
      appearance: 'light',
      palette: 'plum',
    });
  });
});
