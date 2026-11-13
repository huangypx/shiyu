import { useCallback, useEffect, useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { useSettingsStore } from '@/features/settings/settingsStore';
import {
  cancelDesktopTranscription,
  copyText,
  organizeSession,
  toggleDesktopRecording,
} from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';

// 视图只发命令；麦克风采集、转写和整理都在 Go 后端。
export function useRecordingActions() {
  const feedback = useFeedback();

  const toggleRecording = useCallback(() => {
    void toggleDesktopRecording()?.catch(() => {
      feedback('暂时无法开始录音', 'error');
    });
  }, [feedback]);

  const cancelTranscription = useCallback(() => {
    void cancelDesktopTranscription()?.catch(() => undefined);
  }, []);

  const runOrganize = useCallback(() => {
    void organizeSession()?.catch(() => undefined);
  }, []);

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
