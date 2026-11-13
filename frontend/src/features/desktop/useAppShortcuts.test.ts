import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import { useAppShortcuts } from './useAppShortcuts';

function pressMeta(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true }));
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    useUiStore.setState({ settingsOpen: false });
    useDesktopStore
      .getState()
      .setRuntime({ platform: 'darwin', closeRequested: false });
  });

  it('新建快捷键使用工具栏的操作', () => {
    const newRecord = vi.fn();
    renderHook(() => useAppShortcuts(newRecord));
    pressMeta('n');
    expect(newRecord).toHaveBeenCalledTimes(1);
    useUiStore.getState().openSettings();
    pressMeta('n');
    expect(newRecord).toHaveBeenCalledTimes(1);
  });

  it('⌘, 打开偏好设置', () => {
    renderHook(() => useAppShortcuts(vi.fn()));
    pressMeta(',');
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });
});
