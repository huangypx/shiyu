import { create } from 'zustand';

import type { CallMetrics } from '@/types/models';

// arming 是「正在开启麦克风」：此时采集还没确认在跑，
// 界面不能提前显示录音态，否则用户开口的前一段会丢。
export type SessionStatus = 'idle' | 'arming' | 'recording' | 'processing';

type SessionState = {
  status: SessionStatus;
  transcript: string;
  organized: string;
  metrics: CallMetrics;
  elapsedMs: number;
  copied: boolean;
  setStatus: (status: SessionStatus) => void;
  setTranscript: (transcript: string) => void;
  setOrganized: (organized: string) => void;
  setMetrics: (metrics: CallMetrics) => void;
  setElapsedMs: (elapsedMs: number) => void;
  setCopied: (copied: boolean) => void;
  resetDraft: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  status: 'idle',
  transcript: '',
  organized: '',
  metrics: {},
  elapsedMs: 0,
  copied: false,
  setStatus: (status) => set({ status }),
  setTranscript: (transcript) => set({ transcript }),
  setOrganized: (organized) => set({ organized }),
  setMetrics: (metrics) => set({ metrics }),
  setElapsedMs: (elapsedMs) => set({ elapsedMs }),
  setCopied: (copied) => set({ copied }),
  resetDraft: () => set({ transcript: '', organized: '', metrics: {} }),
}));
