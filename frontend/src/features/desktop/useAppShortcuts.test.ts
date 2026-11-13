import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

import { useAppShortcuts } from './useAppShortcuts';

function pressMeta(key: string) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true }));
}

describe('useAppShortcuts', () => {
  beforeEach(() => {
    localStorage.clear();
    useUiStore.setState({ settingsOpen: false });
    useSessionStore.setState({ transcript: '', organized: '' });
    // 浏览器预览下快捷键整体跳过，测试里固定成桌面平台。
    useDesktopStore.setState((state) => ({
      runtime: { ...state.runtime, platform: 'darwin' },
    }));
  });

  it('⌘N 清空本次草稿', () => {
    useSessionStore.setState({ transcript: '记一下', organized: '记一下。' });
    renderHook(() => useAppShortcuts());

    pressMeta('n');
    expect(useSessionStore.getState().transcript).toBe('');
    expect(useSessionStore.getState().organized).toBe('');
  });

  it('⌘, 仍然打开偏好设置', () => {
    renderHook(() => useAppShortcuts());
    pressMeta(',');
    expect(useUiStore.getState().settingsOpen).toBe(true);
  });
});
