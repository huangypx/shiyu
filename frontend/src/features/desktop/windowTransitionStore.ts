import { create } from 'zustand';

import type { WindowTransitionPayload } from '@/services/bridge';

import type { WindowTransition } from './transitionGeometry';

// 状态事件到达后再让遮罩淡出；220ms 覆盖 160ms 遮罩淡出和
// 主界面 200ms 入场，避免最后一帧被提前拆掉。
const SETTLE_MS = 220;
// 事件丢失时的兜底：超过动画时长 3 秒仍没收到 state，就必须
// 把遮罩撤掉，否则整个窗口会一直停在遮罩后面。
const WATCHDOG_EXTRA_MS = 3000;

let nextId = 1;
let settleTimer: number | undefined;
let watchdogTimer: number | undefined;

function clearWatchdog() {
  if (watchdogTimer !== undefined) {
    window.clearTimeout(watchdogTimer);
    watchdogTimer = undefined;
  }
}

function clearTimers() {
  clearWatchdog();
  if (settleTimer !== undefined) {
    window.clearTimeout(settleTimer);
    settleTimer = undefined;
  }
}

type WindowTransitionState = {
  transition: WindowTransition | null;
  start: (payload: WindowTransitionPayload) => void;
  settle: () => void;
  clear: () => void;
};

export const useWindowTransitionStore = create<WindowTransitionState>()(
  (set, get) => ({
    transition: null,
    start: (payload) => {
      clearTimers();
      const id = nextId;
      nextId += 1;
      set({
        transition: { ...payload, id, phase: 'running' },
      });
      watchdogTimer = window.setTimeout(() => {
        watchdogTimer = undefined;
        if (get().transition?.id === id) set({ transition: null });
      }, payload.durationMs + WATCHDOG_EXTRA_MS);
    },
    settle: () => {
      const current = get().transition;
      if (!current || current.phase !== 'running') return;
      clearWatchdog();
      set({ transition: { ...current, phase: 'settling' } });
      settleTimer = window.setTimeout(() => {
        settleTimer = undefined;
        if (get().transition?.id === current.id) set({ transition: null });
      }, SETTLE_MS);
    },
    clear: () => {
      clearTimers();
      set({ transition: null });
    },
  }),
);
