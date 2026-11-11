import { create } from 'zustand';

import type { CallMetrics } from '@/types/models';

// arming 是「正在开启麦克风」：此时采集还没确认在跑，
// 界面不能提前显示录音态，否则用户开口的前一段会丢。
export type SessionStatus = 'idle' | 'arming' | 'recording' | 'processing';

// processing 同时覆盖转写与整理两段，界面却必须说清楚正在做什么：
// 转写中要说「正在识别」，整理中要说「正在整理，马上翻到结果」。
export type SessionStage = 'transcribe' | 'organize' | null;

type SessionState = {
  status: SessionStatus;
  stage: SessionStage;
  transcript: string;
  organized: string;
  metrics: CallMetrics;
  elapsedMs: number;
  copied: boolean;
  setStatus: (status: SessionStatus) => void;
  setStage: (stage: SessionStage) => void;
  setTranscript: (transcript: string) => void;
  setOrganized: (organized: string) => void;
  setMetrics: (metrics: CallMetrics) => void;
  setElapsedMs: (elapsedMs: number) => void;
  setCopied: (copied: boolean) => void;
  resetDraft: () => void;
};

export const useSessionStore = create<SessionState>()((set) => ({
  status: 'idle',
  stage: null,
  transcript: '',
  organized: '',
  metrics: {},
  elapsedMs: 0,
  copied: false,
  setStatus: (status) => set({ status }),
  setStage: (stage) => set({ stage }),
  setTranscript: (transcript) => set({ transcript }),
  setOrganized: (organized) => set({ organized }),
  setMetrics: (metrics) => set({ metrics }),
  setElapsedMs: (elapsedMs) => set({ elapsedMs }),
  setCopied: (copied) => set({ copied }),
  resetDraft: () =>
    set({ transcript: '', organized: '', metrics: {}, stage: null }),
}));
