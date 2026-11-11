import { create } from 'zustand';

import {
  APPEARANCE_KEY,
  readStoredObject,
  writeStored,
} from '@/services/storage';

export type NoticeTone = 'success' | 'error';
export type Appearance = 'system' | 'light' | 'dark';

export type Notice = { id: number; message: string; tone: NoticeTone };

type UiState = {
  sidebarOpen: boolean;
  settingsOpen: boolean;
  notice: Notice | null;
  bubbleFlash: 'success' | 'error' | '';
  appearance: Appearance;
  openSidebar: () => void;
  closeSidebar: () => void;
  toggleSidebar: () => void;
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
