import { create } from 'zustand';

import {
  APPEARANCE_KEY,
  readStoredObject,
  SIDEBAR_KEY,
  writeStored,
} from '@/services/storage';

export type NoticeTone = 'success' | 'error';
export type Appearance = 'system' | 'light' | 'dark';

export type Notice = { id: number; message: string; tone: NoticeTone };

type UiState = {
  // 抽屉：只在小窗口（≤680px）有意义的覆盖层显隐。
  sidebarOpen: boolean;
  // 折叠：桌面端把侧栏移出布局，顶栏接管窗口左上角。
  // 两种形态的按钮职责不同，不能合成同一个状态。
  sidebarCollapsed: boolean;
  settingsOpen: boolean;
  notice: Notice | null;
  bubbleFlash: 'success' | 'error' | '';
  appearance: Appearance;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
  toggleSidebarCollapsed: () => void;
  openSettings: () => void;
  closeSettings: () => void;
  notify: (message: string, tone?: NoticeTone) => void;
  dismissNotice: () => void;
  flashBubble: (tone: 'success' | 'error') => void;
  setAppearance: (appearance: Appearance) => void;
};

// 浮动窗口只有 92x92，Toast 会被裁掉，因此提示会退化成
// 按钮闪烁；主窗口的 Toast 由 Radix Toast 自己管理时长。
let flashTimer: number | undefined;

export const useUiStore = create<UiState>()((set) => ({
  sidebarOpen: false,
  sidebarCollapsed: readStoredObject<{ collapsed: boolean }>(SIDEBAR_KEY, {
    collapsed: false,
  }).collapsed,
  settingsOpen: false,
  notice: null,
  bubbleFlash: '',
  appearance: readStoredObject<{ appearance: Appearance }>(APPEARANCE_KEY, {
    appearance: 'system',
  }).appearance,
  openSidebar: () => set({ sidebarOpen: true }),
  closeSidebar: () => set({ sidebarOpen: false }),
  toggleSidebar: () =>
    set((current) => ({ sidebarOpen: !current.sidebarOpen })),
  toggleSidebarCollapsed: () =>
    set((current) => {
      const collapsed = !current.sidebarCollapsed;
      writeStored(SIDEBAR_KEY, { collapsed });
      return { sidebarCollapsed: collapsed };
    }),
  openSettings: () => set({ settingsOpen: true, sidebarOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),
  notify: (message, tone = 'success') =>
    set({ notice: { id: Date.now(), message, tone } }),
  dismissNotice: () => set({ notice: null }),
  flashBubble: (tone) => {
    window.clearTimeout(flashTimer);
    set({ bubbleFlash: tone });
    flashTimer = window.setTimeout(() => set({ bubbleFlash: '' }), 1400);
  },
  setAppearance: (appearance) => {
    writeStored(APPEARANCE_KEY, { appearance });
    set({ appearance });
  },
}));
