import { create } from 'zustand';

import {
  APPEARANCE_KEY,
  readStoredObject,
  writeStored,
} from '@/services/storage';

export type NoticeTone = 'success' | 'error';
export type Appearance = 'system' | 'light' | 'dark';
export type Palette = 'celadon' | 'mono' | 'plum';

const stored = readStoredObject<{ appearance?: unknown; palette?: unknown }>(
  APPEARANCE_KEY,
  {},
);

export type Notice = { id: number; message: string; tone: NoticeTone };

type UiState = {
  settingsOpen: boolean;
  notice: Notice | null;
  appearance: Appearance;
  palette: Palette;
  openSettings: () => void;
  closeSettings: () => void;
  notify: (message: string, tone?: NoticeTone) => void;
  dismissNotice: () => void;
  setAppearance: (appearance: Appearance) => void;
  setPalette: (palette: Palette) => void;
};

export const useUiStore = create<UiState>()((set, get) => ({
  settingsOpen: false,
  notice: null,
  appearance:
    stored.appearance === 'light' || stored.appearance === 'dark'
      ? stored.appearance
      : 'system',
  palette:
    stored.palette === 'plum' || stored.palette === 'mono'
      ? stored.palette
      : 'celadon',
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  notify: (message, tone = 'success') =>
    set({ notice: { id: Date.now(), message, tone } }),
  dismissNotice: () => set({ notice: null }),
  setAppearance: (appearance) => {
    writeStored(APPEARANCE_KEY, { appearance, palette: get().palette });
    set({ appearance });
  },
  setPalette: (palette) => {
    writeStored(APPEARANCE_KEY, { appearance: get().appearance, palette });
    set({ palette });
  },
}));
