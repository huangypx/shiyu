import { create } from 'zustand';

import { publishSession, type SessionSnapshot } from '@/services/bridge';
import type { CallMetrics } from '@/types/models';

// arming 是「正在开启麦克风」：此时采集还没确认在跑，
// 界面不能提前显示录音态，否则用户开口的前一段会丢。
export type SessionStatus = 'idle' | 'arming' | 'recording' | 'processing';

// processing 同时覆盖转写与整理两段，界面却必须说清楚正在做什么。
export type SessionStage = 'transcribe' | 'organize' | null;

// 两栏各自复制：按「复制成功的栏」记一次短暂的勾，另一栏的按钮不会跟着变。
export type CopyTarget = '' | 'asr' | 'llm';

type SessionState = {
  status: SessionStatus;
  stage: SessionStage;
  transcript: string;
  organized: string;
  metrics: CallMetrics;
  // 处理阶段开始的绝对时间；窗口重建后计时器仍能接上。
  stageStartedAt: number;
  // Go 侧的单调版本号，用来丢弃乱序事件。
  revision: number;
  // 仅本窗口使用的呈现状态，不写回 Go。
  copied: CopyTarget;
  applySnapshot: (snapshot: SessionSnapshot) => void;
  setStatus: (status: SessionStatus) => void;
  setStage: (stage: SessionStage) => void;
  setTranscript: (transcript: string) => void;
  setOrganized: (organized: string) => void;
  setMetrics: (metrics: CallMetrics) => void;
  setCopied: (copied: CopyTarget) => void;
  resetDraft: () => void;
};

let publishTimer: number | undefined;

// 同一轮事件循环里的多次 set 合并成一次发布；增量文本仍然
// 按每个音频块更新，频率与界面原本一致。
function schedulePublish(get: () => SessionState) {
  if (publishTimer !== undefined) return;
  publishTimer = window.setTimeout(() => {
    publishTimer = undefined;
    const state = get();
    void publishSession({
      status: state.status,
      stage: state.stage,
      transcript: state.transcript,
      organized: state.organized,
      metrics: state.metrics,
      stageStartedAt: state.stageStartedAt,
      revision: state.revision,
    })?.catch(() => undefined);
  }, 0);
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  status: 'idle',
  stage: null,
  transcript: '',
  organized: '',
  metrics: {},
  stageStartedAt: 0,
  revision: 0,
  copied: '',
  applySnapshot: (snapshot) =>
    set((current) => {
      if (snapshot.revision < current.revision) return current;
      return {
        status: snapshot.status,
        stage: snapshot.stage,
        transcript: snapshot.transcript,
        organized: snapshot.organized,
        metrics: snapshot.metrics ?? {},
        stageStartedAt: snapshot.stageStartedAt,
        revision: snapshot.revision,
      };
    }),
  setStatus: (status) => {
    const current = get();
    const startsProcessing =
      status === 'processing' && current.status !== 'processing';
    set({
      status,
      stageStartedAt:
        status === 'processing'
          ? startsProcessing
            ? Date.now()
            : current.stageStartedAt
          : 0,
    });
    schedulePublish(get);
  },
  setStage: (stage) => {
    set((current) => ({
      stage,
      stageStartedAt:
        stage && current.stageStartedAt === 0
          ? Date.now()
          : current.stageStartedAt,
    }));
    schedulePublish(get);
  },
  setTranscript: (transcript) => {
    set({ transcript });
    schedulePublish(get);
  },
  setOrganized: (organized) => {
    set({ organized });
    schedulePublish(get);
  },
  setMetrics: (metrics) => {
    set({ metrics });
    schedulePublish(get);
  },
  setCopied: (copied) => set({ copied }),
  resetDraft: () => {
    set({
      transcript: '',
      organized: '',
      metrics: {},
      stage: null,
      stageStartedAt: 0,
    });
    schedulePublish(get);
  },
}));
