import { useCallback, useEffect, useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { useCallsStore } from '@/features/calls/callsStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { describeError } from '@/lib/error';
import { MOCK_METRICS, MOCK_ORGANIZED } from '@/mocks/demo';
import {
  cancelDesktopTranscription,
  cancelTranscriptionRequest,
  copyText,
  loadCalls,
  organize,
  toggleDesktopRecording,
  TransferCancelled,
} from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';
import type { CallMetrics } from '@/types/models';

import { deliverSessionResult, saveSessionNote } from './sessionPersistence';

// 视图侧只发命令；真正的录音采集在 overlay 宿主窗口里。
let organizeToken = 0;
let organizeAbort: AbortController | null = null;

// 失败时要保证面板说的是真话：被拒绝的 Wails Promise 只带消息，
// 失败记录得从调用日志里读回来。
function useFailureRecord() {
  return useCallback(async () => {
    const records = await loadCalls().catch(() => undefined);
    const newest = records?.[0];
    if (!newest) return;
    const current = useSessionStore.getState().metrics;
    useSessionStore
      .getState()
      .setMetrics(
        newest.kind === 'asr'
          ? { ...current, asr: newest }
          : { ...current, llm: newest },
      );
  }, []);
}

// 只暴露动作：页面需要 toggle/cancel/整理/复制，但不该因为
// 输入框里的每个字符而重渲染整个路由。
export function useRecordingActions() {
  const feedback = useFeedback();
  const showFailureRecord = useFailureRecord();

  const toggleRecording = useCallback(() => {
    void toggleDesktopRecording()?.catch(() => {
      feedback('暂时无法开始录音', 'error');
    });
  }, [feedback]);

  const cancelTranscription = useCallback(() => {
    // 视图自己发起的「重新整理」也要立刻作废，并中断在途请求。
    organizeToken += 1;
    organizeAbort?.abort();
    organizeAbort = null;
    void cancelDesktopTranscription()?.catch(() => undefined);
    void cancelTranscriptionRequest()?.catch(() => undefined);
  }, []);

  const runOrganize = useCallback(async () => {
    const session = useSessionStore.getState();
    if (!session.transcript.trim() || session.status === 'processing') return;
    session.setStatus('processing');
    session.setStage('organize');
    session.setElapsedMs(0);

    organizeToken += 1;
    const token = organizeToken;
    const controller = new AbortController();
    organizeAbort = controller;
    try {
      const outcome = await organize(
        session.transcript,
        useSettingsStore.getState().models,
        controller.signal,
      );
      if (token !== organizeToken) return;
      const latest = useSessionStore.getState();
      // 新一次录音可能已经在这段时间里开始，过期的结果不能覆盖它。
      if (latest.status !== 'processing') return;

      const result =
        outcome === undefined
          ? MOCK_ORGANIZED
          : outcome.text.trim() || latest.transcript;
      const nextMetrics: CallMetrics =
        outcome === undefined
          ? MOCK_METRICS
          : { ...latest.metrics, llm: outcome.call };
      latest.setMetrics(nextMetrics);
      latest.setOrganized(
        useSettingsStore.getState().desktop.showResultPreview ? result : '',
      );
      saveSessionNote(latest.transcript, result, nextMetrics);
      await deliverSessionResult(result, feedback);
    } catch (error) {
      if (error instanceof TransferCancelled || token !== organizeToken) return;
      feedback(`整理失败：${describeError(error)}`, 'error');
      await showFailureRecord();
    } finally {
      if (organizeAbort === controller) organizeAbort = null;
      void useCallsStore.getState().refresh();
      if (
        token === organizeToken &&
        useSessionStore.getState().status === 'processing'
      ) {
        useSessionStore.getState().setStatus('idle');
        useSessionStore.getState().setStage(null);
      }
    }
  }, [feedback, showFailureRecord]);

  // 切换预设只改「下一次整理用什么」，不自动重跑已有的结果。
  const selectPreset = useCallback((id: string) => {
    void useSettingsStore.getState().selectPreset(id);
  }, []);

  const copyResult = useCallback(async () => {
    const { organized: current } = useSessionStore.getState();
    if (!current) return;
    await copyText(current);
    useSessionStore.getState().setCopied(true);
    feedback('已复制到剪贴板');
    window.setTimeout(() => useSessionStore.getState().setCopied(false), 1600);
  }, [feedback]);

  const clearDraft = useCallback(() => {
    useSessionStore.getState().resetDraft();
    feedback('已清空');
  }, [feedback]);

  return useMemo(
    () => ({
      toggleRecording,
      cancelTranscription,
      runOrganize,
      copyResult,
      clearDraft,
      selectPreset,
    }),
    [
      cancelTranscription,
      clearDraft,
      copyResult,
      runOrganize,
      selectPreset,
      toggleRecording,
    ],
  );
}

// 页面同时需要状态与动作；这里只订阅它自己要渲染的字段。
export function useRecordingSession() {
  const actions = useRecordingActions();
  const language = useSettingsStore((state) => state.models.language);
  const presets = useSettingsStore((state) => state.models.presets);
  const activePresetId = useSettingsStore(
    (state) => state.models.activePresetId,
  );
  const status = useSessionStore((state) => state.status);
  const stage = useSessionStore((state) => state.stage);
  const transcript = useSessionStore((state) => state.transcript);
  const organized = useSessionStore((state) => state.organized);
  const metrics = useSessionStore((state) => state.metrics);
  const elapsedMs = useSessionStore((state) => state.elapsedMs);
  const copied = useSessionStore((state) => state.copied);
  const setTranscript = useSessionStore((state) => state.setTranscript);
  const setOrganized = useSessionStore((state) => state.setOrganized);
  const setMetrics = useSessionStore((state) => state.setMetrics);

  return {
    language,
    presets,
    activePresetId,
    status,
    isArming: status === 'arming',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    stage,
    isOrganizing: status === 'processing' && stage === 'organize',
    transcript,
    organized,
    metrics,
    elapsedMs,
    copied,
    setTranscript,
    setOrganized,
    setMetrics,
    ...actions,
  };
}

// 没有计数器时，阻塞中的服务商调用和卡死看起来一模一样。
export function useProcessingTimer(isProcessing: boolean) {
  const stageStartedAt = useSessionStore((state) => state.stageStartedAt);
  const setElapsedMs = useSessionStore((state) => state.setElapsedMs);
  useEffect(() => {
    if (!isProcessing || !stageStartedAt) return;
    const tick = () => setElapsedMs(Math.max(0, Date.now() - stageStartedAt));
    tick();
    const timer = window.setInterval(tick, 200);
    return () => window.clearInterval(timer);
  }, [isProcessing, setElapsedMs, stageStartedAt]);
}
