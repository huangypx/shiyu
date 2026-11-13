import { create } from 'zustand';

import { DEFAULT_PALETTE, isPaletteId, type PaletteId } from '@/lib/palettes';
import {
  APPEARANCE_KEY,
  readStoredObject,
  RECORD_SPLIT_KEY,
  writeStored,
} from '@/services/storage';

export type NoticeTone = 'success' | 'error';
export type Appearance = 'system' | 'light' | 'dark';

export type Notice = { id: number; message: string; tone: NoticeTone };

type UiState = {
  settingsOpen: boolean;
  // 记录页两栏的宽度比例（0.28–0.72）：太窄一边就放不下栏头控件。
  recordSplit: number;
  notice: Notice | null;
  bubbleFlash: 'success' | 'error' | '';
  // 底部胶囊的圆内闪示：窗口马上消失，不用 Toast，只闪 Check/X。
  overlayFlash: 'success' | 'error' | '';
  appearance: Appearance;
  palette: PaletteId;
  openSettings: () => void;
  closeSettings: () => void;
  setRecordSplit: (split: number) => void;
  notify: (message: string, tone?: NoticeTone) => void;
  dismissNotice: () => void;
  flashBubble: (tone: 'success' | 'error') => void;
  flashOverlay: (tone: 'success' | 'error') => void;
  setAppearance: (appearance: Appearance) => void;
  setPalette: (palette: PaletteId) => void;
};

// 浮动窗口只有 92x92，Toast 会被裁掉，因此提示会退化成
// 按钮闪烁；主窗口的 Toast 由 Radix Toast 自己管理时长。
let flashTimer: number | undefined;
let splitTimer: number | undefined;

// 两栏比例限制在 28%–72%：再窄就有栏头的控件放不下。
function clampSplit(split: number) {
  if (!Number.isFinite(split)) return 0.5;
  return Math.min(0.72, Math.max(0.28, split));
}
// 胶囊闪示单独计时：它要在 Go 隐藏窗口前清掉，残留的勾/叉
// 才不会漏进下一次叫出胶囊时的 idle 圆。
let overlayFlashTimer: number | undefined;

export const useUiStore = create<UiState>()((set, get) => {
  // readStoredObject 只做浅合并，旧版本或手改过的 JSON 会把任意字符串
  // 原样带进来，所以外观和主题都得在入口显式校验，未知值回落默认。
  const stored = readStoredObject<{ appearance?: unknown; palette?: unknown }>(
    APPEARANCE_KEY,
    {},
  );
  return {
    settingsOpen: false,
    recordSplit: clampSplit(
      readStoredObject<{ split: number }>(RECORD_SPLIT_KEY, { split: 0.5 })
        .split,
    ),
    notice: null,
    bubbleFlash: '',
    overlayFlash: '',
    appearance:
      stored.appearance === 'light' || stored.appearance === 'dark'
        ? stored.appearance
        : 'system',
    palette: isPaletteId(stored.palette) ? stored.palette : DEFAULT_PALETTE,
    openSettings: () => set({ settingsOpen: true }),
    closeSettings: () => set({ settingsOpen: false }),
    setRecordSplit: (split) => {
      const next = clampSplit(split);
      set({ recordSplit: next });
      // 拖动时每一帧都写 localStorage 会拖慢重排，松手后再落盘。
      window.clearTimeout(splitTimer);
      splitTimer = window.setTimeout(() => {
        writeStored(RECORD_SPLIT_KEY, { split: next });
      }, 160);
    },
    notify: (message, tone = 'success') =>
      set({ notice: { id: Date.now(), message, tone } }),
    dismissNotice: () => set({ notice: null }),
    flashBubble: (tone) => {
      window.clearTimeout(flashTimer);
      set({ bubbleFlash: tone });
      flashTimer = window.setTimeout(() => set({ bubbleFlash: '' }), 1400);
    },
    flashOverlay: (tone) => {
      window.clearTimeout(overlayFlashTimer);
      set({ overlayFlash: tone });
      // 400ms 与 Go 隐藏胶囊的宽限一致：勾/叉在窗口消失前退场，
      // 隐藏后再叫出胶囊时 idle 圆里不会残留上一次的闪示。
      overlayFlashTimer = window.setTimeout(
        () => set({ overlayFlash: '' }),
        400,
      );
    },
    setAppearance: (appearance) => {
      // 外观和主题同存一个对象，而 localStorage 是整对象覆盖写：
      // 少带另一项等于把它删掉，因此必须用 get() 取出后一起写。
      writeStored(APPEARANCE_KEY, { appearance, palette: get().palette });
      set({ appearance });
    },
    setPalette: (palette) => {
      writeStored(APPEARANCE_KEY, { appearance: get().appearance, palette });
      set({ palette });
    },
  };
});
