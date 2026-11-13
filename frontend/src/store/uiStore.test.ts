import { beforeEach, describe, expect, it, vi } from 'vitest';

import { APPEARANCE_KEY } from '@/services/storage';

describe('外观偏好恢复', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });

  it('旧配置缺少配色时选用青瓷，保留原有明暗偏好', async () => {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ appearance: 'dark' }),
    );
    const { useUiStore } = await import('./uiStore');
    expect(useUiStore.getState()).toMatchObject({
      palette: 'celadon',
      appearance: 'dark',
    });
    useUiStore.getState().setPalette('plum');
    vi.resetModules();
    const restored = (await import('./uiStore')).useUiStore.getState();
    expect(restored).toMatchObject({ palette: 'plum', appearance: 'dark' });
  });

  it('无有效配色和明暗值时使用默认偏好', async () => {
    localStorage.setItem(
      APPEARANCE_KEY,
      JSON.stringify({ appearance: false, palette: 'unknown' }),
    );
    const { useUiStore } = await import('./uiStore');
    expect(useUiStore.getState()).toMatchObject({
      palette: 'celadon',
      appearance: 'system',
    });
  });
});
