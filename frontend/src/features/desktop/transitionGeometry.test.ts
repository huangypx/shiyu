import { describe, expect, it } from 'vitest';

import { computeBubbleness, transitionVars } from './transitionGeometry';

describe('computeBubbleness', () => {
  it('收起从主窗口的 0 走到悬浮球的 1', () => {
    expect(computeBubbleness(1000, 92, 1000)).toBe(0);
    expect(computeBubbleness(1000, 92, 546)).toBeCloseTo(0.5);
    expect(computeBubbleness(1000, 92, 92)).toBe(1);
  });

  it('窗口尺寸意外越界时仍夹在 0–1', () => {
    expect(computeBubbleness(1000, 92, 20)).toBe(1);
  });
});

describe('transitionVars', () => {
  it('主窗口端填满整个窗口，没有圆角和填充', () => {
    expect(transitionVars(0, 92, 1000, 820)).toEqual({
      width: 1000,
      height: 820,
      inset: 0,
      radius: 0,
      fill: 0,
      border: 0,
      shadow: 0,
    });
  });

  it('悬浮球端与 72px 按钮重合', () => {
    const vars = transitionVars(1, 92, 92, 92);
    expect(vars.width).toBe(72);
    expect(vars.height).toBe(72);
    expect(vars.inset).toBe(10);
    expect(vars.radius).toBe(36);
    expect(vars.fill).toBe(1);
    expect(vars.border).toBe(1);
    expect(vars.shadow).toBe(1);
  });

  it('窗口为工具栏加高后，水滴仍落在顶部 92px 的球区', () => {
    const vars = transitionVars(1, 92, 92, 126);
    expect(vars.width).toBe(72);
    expect(vars.height).toBe(72);
    expect(vars.inset).toBe(10);
  });

  it('中间帧只贴住 anchor 角，尺寸随窗口一起收敛', () => {
    const vars = transitionVars(0.5, 92, 500, 410);
    expect(vars.width).toBeGreaterThan(72);
    expect(vars.width).toBeLessThan(500);
    expect(vars.height).toBeGreaterThan(72);
    expect(vars.height).toBeLessThan(410);
    expect(vars.inset).toBeGreaterThan(0);
    expect(vars.inset).toBeLessThan(10);
  });
});
