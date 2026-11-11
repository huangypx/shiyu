import type { WindowTransitionPayload } from '@/services/bridge';

export type WindowTransitionPhase = 'running' | 'settling';

export type WindowTransition = WindowTransitionPayload & {
  id: number;
  phase: WindowTransitionPhase;
};

// 水滴在末态要与悬浮球按钮完全重合：92px 宽的球区、72px 按钮、
// 6px 白边。
export const BUBBLE_BUTTON_SIZE = 72;
const BUBBLE_BUTTON_RADIUS = BUBBLE_BUTTON_SIZE / 2;

export type TransitionVars = {
  width: number;
  height: number;
  inset: number;
  radius: number;
  fill: number;
  border: number;
  shadow: number;
};

export function clamp(value: number, low: number, high: number) {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}

export function smoothstep(edge0: number, edge1: number, value: number) {
  if (edge0 === edge1) return value < edge0 ? 0 : 1;
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// bubbleness 统一成「0 = 主窗口，1 = 悬浮球」。收起时窗口从
// fromWidth 缩到 toWidth，直接用当前宽度算进度；0 的除法可能
// 产生 -0，归一成 +0。
export function computeBubbleness(
  fromWidth: number,
  toWidth: number,
  currentWidth: number,
) {
  const span = toWidth - fromWidth;
  if (Math.abs(span) < 1) return 0;
  const progress = clamp((currentWidth - fromWidth) / span, 0, 1);
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  return progress;
}

// 水滴在前半程保持接近矩形，窗口足够小后才快速收圆：主界面
// 已经淡出，视觉上不会出现「内容被圆形裁掉」的突兀感。
//
// 尺寸从整个窗口收到 72px 按钮，并且只贴住 anchor 角；收起时
// 水滴始终对着悬浮球那一侧，窗口缩小时不会先整块跳到左上角。
export function transitionVars(
  bubbleness: number,
  bubbleWidth: number,
  windowWidth: number,
  windowHeight: number,
): TransitionVars {
  const shape = smoothstep(0.45, 1, bubbleness);
  const endInset = Math.max(0, (bubbleWidth - BUBBLE_BUTTON_SIZE) / 2);
  return {
    width:
      windowWidth +
      (BUBBLE_BUTTON_SIZE - windowWidth) * clamp(bubbleness, 0, 1),
    height:
      windowHeight +
      (BUBBLE_BUTTON_SIZE - windowHeight) * clamp(bubbleness, 0, 1),
    inset: endInset * shape,
    radius: BUBBLE_BUTTON_RADIUS * shape,
    fill: smoothstep(0.78, 1, bubbleness),
    border: smoothstep(0.84, 1, bubbleness),
    shadow: smoothstep(0.72, 1, bubbleness),
  };
}
