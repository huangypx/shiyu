import { beforeEach, describe, expect, it } from 'vitest';

import { SIDEBAR_KEY } from '@/services/storage';

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

  it('折叠与抽屉是两个独立状态', () => {
    useUiStore.getState().toggleSidebarCollapsed();
    useUiStore.getState().openSidebar();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });
});
