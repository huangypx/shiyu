import { create } from 'zustand';

import { defaultBackdrop, detectPlatform } from '@/services/platform';
import { DEFAULT_DESKTOP_SETTINGS, type DesktopState } from '@/types/models';

// 首帧就用平台默认值，等控制器返回后再换成真实能力，
// 这样标题栏与系统材质不会闪一下。
function initialRuntime(): DesktopState {
  const platform = detectPlatform();
  return {
    mode: 'main',
    hotkey: DEFAULT_DESKTOP_SETTINGS.hotkey,
    hotkeyRegistered: false,
    autoPaste: DEFAULT_DESKTOP_SETTINGS.autoPaste,
    keepBubbleOnTop: DEFAULT_DESKTOP_SETTINGS.keepBubbleOnTop,
    restoreClipboard: DEFAULT_DESKTOP_SETTINGS.restoreClipboard,
    canInjectText: false,
    bubbleHidden: false,
    closeRequested: false,
    platform,
    backdrop: defaultBackdrop(platform),
  };
}

type DesktopRuntimeState = {
  runtime: DesktopState;
  setRuntime: (patch: Partial<DesktopState>) => void;
};

export const useDesktopStore = create<DesktopRuntimeState>()((set) => ({
  runtime: initialRuntime(),
  setRuntime: (patch) =>
    set((current) => ({ runtime: { ...current.runtime, ...patch } })),
}));
