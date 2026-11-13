import { useCallback, useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { useSettingsStore } from '@/features/settings/settingsStore';
import {
  cancelDesktopTranscription,
  copyText,
  organizeSession,
  toggleDesktopRecording,
} from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';
import { activeAsrModel, presetLlmModel } from '@/types/models';

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

  // 栏头的模型与语言选择器直接切当前配置，选完立刻落盘：
  // 下一次录音与整理就该用新选的那一台、那个语言。
  const selectAsrModel = useCallback((id: string) => {
    void useSettingsStore.getState().selectModel('asr', id);
  }, []);

  const selectLlmModel = useCallback((id: string) => {
    void useSettingsStore.getState().selectModel('llm', id);
  }, []);

  const selectLanguage = useCallback((language: string) => {
    void useSettingsStore.getState().selectLanguage(language);
  }, []);

  // 两栏各自复制：asr 复制识别原文，llm 复制转写内容。
  // 勾只在该栏亮一会儿，另一栏的按钮不会跟着变成「已复制」。
  const copyPane = useCallback(
    async (target: 'asr' | 'llm') => {
      const { transcript, organized } = useSessionStore.getState();
      const text = target === 'asr' ? transcript : organized;
      if (!text) return;
      await copyText(text);
      useSessionStore.getState().setCopied(target);
      feedback(target === 'asr' ? '已复制识别结果' : '已复制转写内容');
      window.setTimeout(() => useSessionStore.getState().setCopied(''), 1600);
    },
    [feedback],
  );
  const copyResult = useCallback(() => copyPane('llm'), [copyPane]);
  const copyTranscript = useCallback(() => copyPane('asr'), [copyPane]);

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
      copyTranscript,
      clearDraft,
      selectPreset,
      selectAsrModel,
      selectLlmModel,
      selectLanguage,
    }),
    [
      cancelTranscription,
      clearDraft,
      copyResult,
      copyTranscript,
      runOrganize,
      selectAsrModel,
      selectLanguage,
      selectLlmModel,
      selectPreset,
      toggleRecording,
    ],
  );
}

// 页面同时需要状态与动作；这里只订阅它自己要渲染的字段。
export function useRecordingSession() {
  const actions = useRecordingActions();
  // 栏头要显示模型配置，整份 models 一起订阅；切换模型与预设都不频繁，
  // 再拆成几个选择器只会让字段来源分散。
  const models = useSettingsStore((state) => state.models);
  const asrModel = activeAsrModel(models);
  // 栏头显示的是这次录音真正会用到的语言：模型自己设了语言就优先，
  // 与 Go 后端「模型语言为空才跟随全局」的规则一致。
  const language = asrModel.language ?? models.language;
  const presets = models.presets;
  const activePresetId = models.activePresetId;
  const status = useSessionStore((state) => state.status);
  const stage = useSessionStore((state) => state.stage);
  const transcript = useSessionStore((state) => state.transcript);
  const organized = useSessionStore((state) => state.organized);
  const copied = useSessionStore((state) => state.copied);
  const setTranscript = useSessionStore((state) => state.setTranscript);
  const setOrganized = useSessionStore((state) => state.setOrganized);

  return {
    language,
    presets,
    activePresetId,
    // 栏头显示的是这次录音与整理实际会用到的那两台模型：
    // 预设绑定了模型时，右栏显示的不是全局生效的那一台。
    asrModel,
    llmModel: presetLlmModel(models, activePresetId),
    // 下拉框要列出配置里的全部模型，才能当场换一台。
    asrModels: models.asrModels,
    llmModels: models.llmModels,
    status,
    isArming: status === 'arming',
    isRecording: status === 'recording',
    isProcessing: status === 'processing',
    stage,
    transcript,
    organized,
    copied,
    setTranscript,
    setOrganized,
    ...actions,
  };
}
