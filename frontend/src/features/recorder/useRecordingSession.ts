import { useCallback, useEffect, useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { useCallsStore } from '@/features/calls/callsStore';
import { useNotesStore } from '@/features/history/notesStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { describeError } from '@/lib/error';
import { MOCK_METRICS, MOCK_ORGANIZED, MOCK_TRANSCRIPT } from '@/mocks/demo';
import {
  blobToDataUrl,
  cancelTranscriptionRequest,
  copyText,
  finishForegroundRecording,
  focusedBubbleInput,
  loadCalls,
  organize,
  pasteBubbleResult,
  startRecording,
  stopRecording,
  subscribeAsrPartial,
  transcribe,
  TransferCancelled,
} from '@/services/bridge';
import {
  describeMicError,
  startWavRecording,
  type WavRecorder,
} from '@/services/recorder';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import type { CallMetrics, CallRecord } from '@/types/models';

// 录音器实例跨组件共享：全局快捷键可能在 App 层触发录音，
// 停止按钮却在页面组件里，放在组件 ref 里会丢实例。
let activeRecorder: WavRecorder | null = null;
// 在开始录音时记住输入目标，避免整理期间切换窗口后把文字送给另一个应用。
let recordingTarget: Promise<string> | undefined;

function inBubble() {
  return useDesktopStore.getState().runtime.mode === 'bubble';
}
// 每次开始录音换一个代号：麦克风权限弹窗可能停留很久，
// 迟到的启动结果要靠它认出「用户已经取消」。
let startToken = 0;
// 开启麦克风阶段的采集器：这一阶段用户取消时也得立刻关掉，
// 否则麦克风要一直占用到 ready 的兜底超时。
let armingRecorder: WavRecorder | null = null;
// 流式转写推来的增量文本落在这里；为空表示当前没有等待中的处理，
// 迟到的文本应当直接丢弃。
let partialSink: ((text: string) => void) | null = null;
// 每次进入处理阶段换一个代号：用户取消后，迟到的转写结果和增量
// 文本都靠它认出「已经不要了」。
let processingToken = 0;
let processingAbort: AbortController | null = null;

// 增量文本的订阅只建立一次：多个组件都会调用 useRecordingActions，
// 各自订阅会把同一段文本重复写进面板。
void subscribeAsrPartial((text) => partialSink?.(text));

// beginProcessing 为一次处理登记取消能力：AbortController 让等待方
// 立刻结束，后端的 CancelTranscription 负责中断在途请求。
function beginProcessing() {
  const token = (processingToken += 1);
  const controller = new AbortController();
  processingAbort = controller;
  return { token, controller };
}

function endProcessing(token: number, controller: AbortController) {
  if (processingAbort === controller) processingAbort = null;
  if (token === processingToken) partialSink = null;
}

// guardProcessing 在每个 await 之后调用：取消可能发生在任何一次
// 往返之间，结果必须按代号丢弃。
function guardProcessing(token: number) {
  if (token !== processingToken) throw new TransferCancelled();
}

// 只暴露动作：App 需要把 toggleRecording 交给快捷键与浮动窗，
// 但不该因为输入框里的每个字符而重渲染整个路由。
export function useRecordingActions() {
  const settings = useSettingsStore((state) => state.models);
  const desktop = useSettingsStore((state) => state.desktop);
  const feedback = useFeedback();

  const setCopied = useSessionStore((state) => state.setCopied);
  const resetDraft = useSessionStore((state) => state.resetDraft);

  const saveNote = useCallback(
    (text: string, result: string, callMetrics?: CallMetrics) => {
      // 预设名按调用时的名字记下来：之后改名不该改写已有历史。
      const presetName = settings.presets.find(
        (preset) => preset.id === settings.activePresetId,
      )?.name;
      // 桌面端的裁剪由 SQLite 的保留期负责，不传条数上限；
      // 浏览器预览仍用上限，避免 localStorage 无限增长。
      useNotesStore
        .getState()
        .addNote({ text, result, metrics: callMetrics, presetName }, 0);
    },
    [settings.presets, settings.activePresetId],
  );

  const deliverResult = useCallback(
    async (result: string, token: number, originalTarget?: Promise<string>) => {
      if (originalTarget || inBubble()) {
        // 整理已经完成。胶囊先提供全文，查找输入框或粘贴的耗时不应占用录音入口。
        useSessionStore.setState({
          bubbleResult: result,
          status: 'idle',
          stage: null,
        });
        if (!desktop.autoPaste || !originalTarget) return;
        const target = await originalTarget;
        guardProcessing(token);
        if (target) {
          try {
            // 原生侧会复核当前模式和焦点，较晚到达的窗口事件不会改变录音的目标。
            await pasteBubbleResult(result, target);
          } catch (error) {
            guardProcessing(token);
            feedback(`粘贴失败：${describeError(error)}`, 'error');
          }
        }
        return;
      }
      try {
        const outcome = await finishForegroundRecording(
          result,
          desktop.autoPaste,
        );
        guardProcessing(token);
        if (outcome === 'bubble' || inBubble())
          useSessionStore.getState().setBubbleResult(result);
        else if (outcome === 'pasted') feedback('已整理并粘贴到当前光标');
        else if (outcome === 'copied') feedback('已整理，结果已复制到剪贴板');
        else feedback('已完成转写和整理');
      } catch {
        guardProcessing(token);
        if (inBubble()) useSessionStore.getState().setBubbleResult(result);
        else feedback('已整理，自动粘贴失败，结果仍在剪贴板中');
      }
    },
    [desktop.autoPaste, feedback],
  );

  // 失败时要保证面板说的是真话：被拒绝的 Wails Promise
  // 只带消息，失败记录得从调用日志里读回来。
  const showFailureRecord = useCallback(async () => {
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

  const finishRecording = useCallback(
    async (blob?: Blob) => {
      const session = useSessionStore.getState();
      const target = recordingTarget;
      recordingTarget = undefined;
      session.setStatus('processing');
      // 先记下正在转写：界面据此说「正在识别」，
      // 整理阶段再换成「正在整理」。
      session.setStage('transcribe');
      session.setElapsedMs(0);
      const { token, controller } = beginProcessing();
      // 流式转写时文字边生成边上屏；载荷是累计文本，直接覆盖即可。
      partialSink = (text) => {
        if (token === processingToken) {
          useSessionStore.getState().setTranscript(text);
        }
      };
      try {
        await stopRecording();
        const audio = blob ? await blobToDataUrl(blob) : '';
        const transcriptOutcome = await transcribe(
          audio,
          settings,
          controller.signal,
        );
        // 转写已经结束，之后再到的增量文本不该盖掉最终结果。
        partialSink = null;
        guardProcessing(token);
        // 只有浏览器预览（没有 Wails 绑定）完全没配服务商；
        // 已配置的服务商失败时必须把错误暴露出来。
        if (transcriptOutcome === undefined) {
          session.setMetrics(MOCK_METRICS);
          session.setTranscript(MOCK_TRANSCRIPT);
          session.setOrganized(desktop.showResultPreview ? MOCK_ORGANIZED : '');
          if (target || inBubble()) session.setBubbleResult(MOCK_ORGANIZED);
          saveNote(MOCK_TRANSCRIPT, MOCK_ORGANIZED, MOCK_METRICS);
          return;
        }
        const asrCall = transcriptOutcome.call;
        const text = transcriptOutcome.text.trim();
        session.setMetrics({ asr: asrCall });
        session.setTranscript(text);
        // 原文已经上屏，从这里开始等的是整理结果；
        // 卡片翻转由 organized 落地触发，不在这里改视图。
        session.setStage('organize');
        let result = text;
        let llmCall: CallRecord | undefined;
        try {
          // 用最新的设置：录音期间用户可能刚切换了整理预设。
          const organizedOutcome = await organize(
            text,
            useSettingsStore.getState().models,
            controller.signal,
          );
          guardProcessing(token);
          llmCall = organizedOutcome?.call;
          result = organizedOutcome?.text?.trim() || text;
        } catch (error) {
          guardProcessing(token);
          feedback(`整理失败：${describeError(error)}`, 'error');
        }
        const record: CallMetrics = { asr: asrCall, llm: llmCall };
        session.setMetrics(record);
        session.setOrganized(desktop.showResultPreview ? result : '');
        saveNote(text, result, record);
        await deliverResult(result, token, target);
      } catch (error) {
        // 用户主动取消不是失败：既不该弹提示，也不该写历史。
        // 被取消的请求通常以连接中断收尾，因此代号对不上也要静默。
        if (error instanceof TransferCancelled || token !== processingToken) {
          return;
        }
        feedback(`转写失败：${describeError(error)}`, 'error');
        await showFailureRecord();
      } finally {
        endProcessing(token, controller);
        void useCallsStore.getState().refresh();
        // 取消之后可能已经开始了新一次录音，晚到的收尾不能把
        // 那一次的状态改回 idle。
        if (token === processingToken) {
          session.setStatus('idle');
          session.setStage(null);
        }
      }
    },
    [
      deliverResult,
      desktop.showResultPreview,
      feedback,
      saveNote,
      settings,
      showFailureRecord,
    ],
  );

  // 结束当前录音：先把界面收回到处理中，再读音频、交给后端。
  const concludeRecording = useCallback(
    async (recorder: WavRecorder | null) => {
      const session = useSessionStore.getState();
      const token = processingToken;
      session.setStatus('processing');
      let blob: Blob | undefined;
      if (recorder) {
        try {
          blob = await recorder.stop();
        } catch {
          blob = undefined;
        }
      }
      if (token === processingToken) await finishRecording(blob);
    },
    [finishRecording],
  );

  const toggleRecording = useCallback(
    async (hotkeyTarget?: string) => {
      const session = useSessionStore.getState();
      if (session.status === 'processing') return;
      if (session.status === 'recording') {
        const recorder = activeRecorder;
        activeRecorder = null;
        await concludeRecording(recorder);
        return;
      }
      if (session.status === 'arming') {
        // 还在等麦克风时再按一次就是取消：迟到的启动结果由
        // startToken 丢弃，已经拿到的采集器在这里就关掉。
        startToken += 1;
        const pending = armingRecorder;
        armingRecorder = null;
        pending?.cancel();
        session.setStatus('idle');
        feedback('已取消');
        return;
      }
      session.resetDraft();
      if (inBubble()) useUiStore.getState().dismissNotice();
      recordingTarget = inBubble()
        ? hotkeyTarget === undefined
          ? focusedBubbleInput().catch(() => '')
          : Promise.resolve(hotkeyTarget)
        : undefined;
      // 新一次录音开始，上一次处理即便还没收尾也已经作废。
      processingToken += 1;
      session.setStatus('arming');
      const token = (startToken += 1);
      let recorder: WavRecorder | null = null;
      try {
        recorder = await startWavRecording({
          // 录音中被拔掉或撤权限：按正常结束收尾，已经说出口的部分
          // 仍然会送去转写。
          onEnded: () => {
            startToken += 1;
            if (!recorder) return;
            const current = useSessionStore.getState();
            if (current.status === 'arming') {
              // 还没切到录音态设备就断了：同样要退出「开启中」，
              // 否则按钮会一直停在等待麦克风的样子。
              if (armingRecorder === recorder) armingRecorder = null;
              recorder.cancel();
              current.setStatus('idle');
              feedback('麦克风已断开', 'error');
              return;
            }
            if (activeRecorder !== recorder) return;
            activeRecorder = null;
            if (current.status !== 'recording') return;
            feedback('麦克风已断开', 'error');
            void concludeRecording(recorder);
          },
        });
        // 采集器一存在就登记：等 ready 的这段时间用户可能已经取消。
        armingRecorder = recorder;
        if (token !== startToken) {
          recorder.cancel();
          return;
        }
        // 先确认采集真的在跑，再把界面切成录音态：状态诚实时，
        // 用户看到的红色方块就是「现在说话会被录进去」。
        await recorder.ready;
      } catch (error) {
        recorder?.cancel();
        if (token !== startToken) return;
        session.setStatus('idle');
        feedback(`无法使用麦克风：${describeMicError(error)}`, 'error');
        return;
      } finally {
        // 无论成功、失败还是被取消，离开这段流程前都清掉登记，
        // 避免取消分支拿到一个已经收尾的采集器。
        if (armingRecorder === recorder) armingRecorder = null;
      }
      if (token !== startToken) {
        recorder.cancel();
        return;
      }
      activeRecorder = recorder;
      session.setStatus('recording');
      if (!inBubble()) feedback('正在聆听…');
      // 后端的内存会话只是记账，采集已经跑起来了，
      // 不能让它的一次往返把第一句话挡在门外。浏览器预览没有绑定，
      // 这里本来就可能是 undefined。
      void startRecording(settings)?.catch(() => undefined);
    },
    [concludeRecording, feedback, settings],
  );

  const runOrganize = useCallback(async () => {
    const session = useSessionStore.getState();
    if (!session.transcript.trim() || session.status === 'processing') return;
    session.setStatus('processing');
    session.setStage('organize');
    session.setElapsedMs(0);
    const { token, controller } = beginProcessing();
    try {
      // 与 finishRecording 一样读最新设置，选择器切换后立刻生效。
      const outcome = await organize(
        session.transcript,
        useSettingsStore.getState().models,
        controller.signal,
      );
      guardProcessing(token);
      // 没有绑定就是浏览器预览；已配置的服务商失败时
      // 保留原始转写并说明原因。
      const result =
        outcome === undefined
          ? MOCK_ORGANIZED
          : outcome.text.trim() || session.transcript;
      const nextMetrics: CallMetrics =
        outcome === undefined
          ? MOCK_METRICS
          : { ...session.metrics, llm: outcome.call };
      session.setMetrics(nextMetrics);
      session.setOrganized(desktop.showResultPreview ? result : '');
      saveNote(session.transcript, result, nextMetrics);
      await deliverResult(result, token);
    } catch (error) {
      if (error instanceof TransferCancelled || token !== processingToken)
        return;
      feedback(`整理失败：${describeError(error)}`, 'error');
      await showFailureRecord();
    } finally {
      endProcessing(token, controller);
      void useCallsStore.getState().refresh();
      if (token === processingToken) {
        session.setStatus('idle');
        session.setStage(null);
      }
    }
  }, [
    deliverResult,
    desktop.showResultPreview,
    feedback,
    saveNote,
    showFailureRecord,
  ]);

  // 取消这段录音：录音中直接丢弃已采集的音频，因此不会有任何
  // ASR 或 LLM 调用；处理中则中断在途请求并丢掉已经拿到的结果。
  const cancelTranscription = useCallback(() => {
    const session = useSessionStore.getState();
    if (session.status === 'idle') return;
    // 先作废代号，迟到的结果与增量文本都会因为对不上而被丢掉。
    processingToken += 1;
    processingAbort?.abort();
    processingAbort = null;
    partialSink = null;
    if (session.status === 'arming') {
      startToken += 1;
      const pending = armingRecorder;
      armingRecorder = null;
      pending?.cancel();
    } else if (session.status === 'recording') {
      startToken += 1;
      const recorder = activeRecorder;
      activeRecorder = null;
      // cancel 而不是 stop：音频不产出，因此也不会有 blob 送去转写。
      recorder?.cancel();
    }
    // 后端的内存会话只是记账，取消时一并清掉。
    void stopRecording()?.catch(() => undefined);
    // 在途的服务商请求由后端中断；没有在途请求时是空操作。
    void cancelTranscriptionRequest()?.catch(() => undefined);
    session.resetDraft();
    session.setStatus('idle');
    feedback('已取消这段转写');
  }, [feedback]);

  // 切换预设只改「下一次整理用什么」，不自动重跑已有的结果：
  // 自动重跑会在用户只是想先看看别的风格时消耗一次调用。
  const selectPreset = useCallback((id: string) => {
    void useSettingsStore.getState().selectPreset(id);
  }, []);

  const copyResult = useCallback(async () => {
    const { organized, bubbleResult } = useSessionStore.getState();
    const fromBubble = inBubble();
    const current = fromBubble ? bubbleResult : organized;
    if (!current) return;
    try {
      await copyText(current);
    } catch (error) {
      feedback(`复制失败：${describeError(error)}`, 'error');
      return;
    }
    setCopied(true);
    if (!fromBubble) feedback('已复制到剪贴板');
    window.setTimeout(() => setCopied(false), 1600);
  }, [feedback, setCopied]);

  const clearDraft = useCallback(() => {
    resetDraft();
    feedback('已清空');
  }, [feedback, resetDraft]);

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
  const presets = useSettingsStore((state) => state.models.presets);
  const activePresetId = useSettingsStore(
    (state) => state.models.activePresetId,
  );
  const status = useSessionStore((state) => state.status);
  const transcript = useSessionStore((state) => state.transcript);
  const organized = useSessionStore((state) => state.organized);
  const copied = useSessionStore((state) => state.copied);
  const setTranscript = useSessionStore((state) => state.setTranscript);

  return {
    presets,
    activePresetId,
    status,
    transcript,
    organized,
    copied,
    setTranscript,
    ...actions,
  };
}

// 没有计数器时，阻塞中的服务商调用和卡死看起来一模一样。
// 只有页面需要显示计时，所以单独成 hook，避免多个组件
// 各起一个 interval。
export function useProcessingTimer(isProcessing: boolean) {
  useEffect(() => {
    if (!isProcessing) return;
    const startedAt = Date.now();
    const timer = window.setInterval(
      () => useSessionStore.getState().setElapsedMs(Date.now() - startedAt),
      200,
    );
    return () => window.clearInterval(timer);
  }, [isProcessing]);
}
