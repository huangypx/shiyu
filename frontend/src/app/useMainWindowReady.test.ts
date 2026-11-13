import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { markMainWindowReady } from '@/services/bridge';

import { useMainWindowReady } from './useMainWindowReady';

vi.mock('@/services/bridge', () => ({
  markMainWindowReady: vi.fn(() => Promise.resolve()),
}));

describe('useMainWindowReady', () => {
  it('挂载后立即报告主窗口首帧就绪', () => {
    renderHook(() => useMainWindowReady());

    expect(markMainWindowReady).toHaveBeenCalledTimes(1);
  });
});
