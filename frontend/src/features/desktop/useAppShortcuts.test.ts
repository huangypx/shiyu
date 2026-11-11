import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import { useAppShortcuts } from './useAppShortcuts';

function pressMeta(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true }));
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ sidebarCollapsed: false, settingsOpen: false });
    // 浏览器预览下快捷键整体跳过，测试里固定成桌面平台。
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'darwin' },
    }));
  });

  it('⌘\\ 在折叠与展开之间切换侧栏', () => {
    renderHook(() => useAppShortcuts());
    pressMeta('\\');
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
    pressMeta('\\');
    expect(useUiStore.getState().sidebarCollapsed).toBe(false);
  });

  it('⌘, 仍然打开偏好设置', () => {
    renderHook(() => useAppShortcuts());
    pressMeta(',');
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });
});
