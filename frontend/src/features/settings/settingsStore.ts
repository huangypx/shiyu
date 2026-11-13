import { create } from 'zustand';

import {
  applyDesktopSettings,
  configureHotkey,
  loadDesktopSettings,
  loadSettings,
  saveDesktopSettings,
  saveSettings,
  setActiveModel,
  setActivePreset as syncActivePreset,
} from '@/services/bridge';
import {
  DESKTOP_SETTINGS_KEY,
  readStoredObject,
  SETTINGS_KEY,
  writeStored,
} from '@/services/storage';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_SETTINGS,
  type DesktopSettings,
  type ModelSettings,
} from '@/types/models';

type SettingsState = {
  models: ModelSettings;
  desktop: DesktopSettings;
  patchModels: (patch: Partial<ModelSettings>) => void;
  patchDesktop: (patch: Partial<DesktopSettings>) => void;
  // 切换生效预设会立刻落盘：录音结束后的自动整理不经过保存按钮，
  // 只在内存里改会让这次选择丢掉。
  selectPreset: (id: string) => Promise<void>;
  // 切换当前模型同理：下一次录音就该用新的那一台。
  selectModel: (kind: 'asr' | 'llm', id: string) => Promise<void>;
  hydrate: () => Promise<void>;
  save: () => Promise<boolean>;
};

export const useSettingsStore = create<SettingsState>()((set, get) => ({
  models: readStoredObject(SETTINGS_KEY, DEFAULT_SETTINGS),
  desktop: readStoredObject(DESKTOP_SETTINGS_KEY, DEFAULT_DESKTOP_SETTINGS),
  patchModels: (patch) =>
    set((current) => ({ models: { ...current.models, ...patch } })),
  patchDesktop: (patch) =>
    set((current) => ({ desktop: { ...current.desktop, ...patch } })),
  selectPreset: async (id) => {
    const current = get().models;
    const exists = current.presets?.some((preset) => preset.id === id);
    if (!exists) return;
    const next = { ...current, activePresetId: id };
    set({ models: next });
    writeStored(SETTINGS_KEY, next);
    // 桥接失败只影响后端记录，整理请求本身还会显式带 presetId。
    try {
      await syncActivePreset(id);
    } catch {
      // 浏览器预览没有后端，失败在这里是预期行为。
    }
  },
  selectModel: async (kind, id) => {
    const current = get().models;
    const list = kind === 'asr' ? current.asrModels : current.llmModels;
    if (!list.some((model) => model.id === id)) return;
    const next =
      kind === 'asr'
        ? { ...current, activeAsrId: id }
        : { ...current, activeLlmId: id };
    set({ models: next });
    writeStored(SETTINGS_KEY, next);
    try {
      await setActiveModel(kind, id);
    } catch {
      // 同上：预览环境没有后端。
    }
  },
  // 后端配置是权威来源；浏览器预览返回 undefined，保留本地值。
  hydrate: async () => {
    const [remoteModels, remoteDesktop] = await Promise.all([
      loadSettings().catch(() => undefined),
      loadDesktopSettings().catch(() => undefined),
    ]);
    if (remoteModels) {
      set({ models: remoteModels });
      writeStored(SETTINGS_KEY, remoteModels);
    }
    if (remoteDesktop) {
      const merged = { ...get().desktop, ...remoteDesktop };
      set({ desktop: merged });
      writeStored(DESKTOP_SETTINGS_KEY, merged);
    }
  },
  save: async () => {
    const { models, desktop } = get();
    writeStored(SETTINGS_KEY, models);
    writeStored(DESKTOP_SETTINGS_KEY, desktop);
    try {
      await saveSettings(models);
      await saveDesktopSettings(desktop);
      await configureHotkey(desktop.hotkey);
      // 已存在的悬浮球立即跟随「保持置顶」等桌面偏好。
      await applyDesktopSettings();
      return true;
    } catch {
      // 桌面外壳不可用时配置仍写进了 localStorage，
      // 下次启动会重新尝试同步。
      return false;
    }
  },
}));
