import { create } from 'zustand';

import { MOCK_CALLS } from '@/mocks/demo';
import { clearCalls, loadCalls } from '@/services/bridge';
import type { CallRecord } from '@/types/models';

type CallsState = {
  calls: CallRecord[];
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  clear: () => Promise<void>;
};

export const useCallsStore = create<CallsState>()((set) => ({
  calls: [],
  // 首次加载：桌面端读 Go 的会话日志，浏览器预览用演示数据，
  // 否则调用记录页会是一片空白。
  hydrate: async () => {
    const remote = await loadCalls().catch(() => undefined);
    set({ calls: remote ?? MOCK_CALLS });
  },
  refresh: async () => {
    const remote = await loadCalls().catch(() => undefined);
    if (remote) set({ calls: remote });
  },
  clear: async () => {
    try {
      await clearCalls();
    } finally {
      set({ calls: [] });
    }
  },
}));
