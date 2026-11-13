import type { Theme } from '@radix-ui/themes';
import type { ComponentProps } from 'react';

export type PaletteId = 'mono' | 'celadon' | 'plum';

export type PaletteSpec = {
  id: PaletteId;
  label: string;
  description: string;
  accentColor: ComponentProps<typeof Theme>['accentColor'];
  grayColor: ComponentProps<typeof Theme>['grayColor'];
  // 固定明暗的主题不跟系统走；null 表示跟随用户偏好。
  appearance: 'light' | 'dark' | null;
};

// Radix 的内建色板只是兜底：真正决定界面颜色的是 styles/palettes.css
// 里那套 --app-* 语义 token。accentColor / grayColor 只负责让没有被
// 覆盖到的 Radix 组件不至于和自定义画布撞色。
export const PALETTES: readonly PaletteSpec[] = [
  {
    id: 'mono',
    label: '经典黑白',
    description: '沿用中性灰阶，跟随系统明暗',
    accentColor: 'indigo',
    grayColor: 'slate',
    appearance: null,
  },
  {
    id: 'celadon',
    label: '青瓷绿 × 朱红',
    description: '米白纸面与青瓷画布，固定浅色',
    accentColor: 'tomato',
    grayColor: 'sage',
    appearance: 'light',
  },
  {
    id: 'plum',
    label: '深梅紫 × 杏桃',
    description: '梅紫画布与杏桃强调，固定深色',
    accentColor: 'orange',
    grayColor: 'mauve',
    appearance: 'dark',
  },
];

export const DEFAULT_PALETTE: PaletteId = 'mono';

// 主题表是静态的，默认项必然存在；先把兜底对象固化下来，
// paletteById 的返回类型就能保持 PaletteSpec，调用方不必判空。
const DEFAULT_SPEC: PaletteSpec =
  PALETTES.find((palette) => palette.id === DEFAULT_PALETTE) ?? PALETTES[0];

// 值来自 localStorage，类型系统看不到它：旧版本写下的字符串、
// 手改过的 JSON 都会原样漏进来，必须在入口处收口。
export function isPaletteId(value: unknown): value is PaletteId {
  return PALETTES.some((palette) => palette.id === value);
}

export function paletteById(id: PaletteId): PaletteSpec {
  return PALETTES.find((palette) => palette.id === id) ?? DEFAULT_SPEC;
}
