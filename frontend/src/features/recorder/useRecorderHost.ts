import { useCallback, useEffect, useRef } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { useCallsStore } from '@/features/calls/callsStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { describeError } from '@/lib/error';
import { MOCK_METRICS, MOCK_ORGANIZED, MOCK_TRANSCRIPT } from '@/mocks/demo';
import {
  appendRecordingChunk,
  blobToDataUrl,
  cancelRecording,
  cancelTranscriptionRequest,
  finalizeRecording,
  isDesktopRuntime,
  loadCalls,
  organize,
  publishMicLevel,
  startRecording,
  subscribeAsrPartial,
  subscribeDesktopSessionCommand,
  takeSessionCommands,
  transcribe,
  TransferCancelled,
} from '@/services/bridge';
import {
  describeMicError,
  startWavRecording,
  subscribeMicLevel,
  type WavRecorder,
} from '@/services/recorder';
import { useSessionStore } from '@/store/sessionStore';
import type { CallMetrics } from '@/types/models';

import {
  deliverSessionResult,
  saveSessionNote,
  type SessionFeedback,
} from './sessionPersistence';

// 模块级状态只存在于 overlay 采集宿主窗口里：窗口在会话结束后会被
// 销毁，下一次录音重新创建，自然不会串会话。
let activeRecorder: WavRecorder | null = null;
let armingRecorder: WavRecorder | null = null;
let startToken = 0;
let chunkToken = 0;
let streaming = false;
let pendingChunks: string[] = [];
let chunkChain: Promise<unknown> = Promise.resolve();
let partialSink: ((text: string) => void) | null = null;
let processingToken = 0;
let processingAbort: AbortController | null = null;

// 增量文本的订阅只建立一次；宿主窗口销毁时整个 JS 上下文一起消失。
void subscribeAsrPartial((text) => partialSink?.(text));

function int16ToBase64(pcm: Int16Array) {
  const bytes = new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  let binary = '';
  const step = 0x8000;
  for (let index = 0; index < bytes.length; index += step) {
    binary += String.fromCharCode(...bytes.subarray(index, index + step));
  }
  return btoa(binary);
}

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

function guardProcessing(token: number) {
  if (token !== processingToken) throw new TransferCancelled();
}

async function showFailureRecord() {
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
}

function queueChunk(data: string) {
  chunkChain = chunkChain
    .then(() => appendRecordingChunk(data))
    .catch(() => undefined);
}

function cancelArming(feedback: SessionFeedback) {
  startToken += 1;
  const pending = armingRecorder;
  armingRecorder = null;
  pending?.cancel();
  useSessionStore.getState().setStatus('idle');
  feedback('已取消');
}

async function start(feedback: SessionFeedback) {
  // 每次会话开始都重新读配置：宿主窗口可能已经存活了一段时间。
  await useSettingsStore
    .getState()
    .hydrate()
    .catch(() => undefined);
  const settings = useSettingsStore.getState().models;
  const session = useSessionStore.getState();
  session.resetDraft();
  processingToken += 1;
  session.setStatus('arming');

  startToken += 1;
  const token = startToken;
  chunkToken += 1;
  const ownerChunkToken = chunkToken;
  streaming = false;
  pendingChunks = [];
  chunkChain = Promise.resolve();

  const desktop = isDesktopRuntime();
  let recorder: WavRecorder | null = null;
  try {
    recorder = await startWavRecording({
      // 设备被拔掉或权限被撤销：按正常结束收尾，已经说出口的部分
      // 仍然会送去转写。
      onEnded: () => handleEnded(ownerChunkToken, feedback),
      onChunk: desktop ? (pcm) => handleChunk(ownerChunkToken, pcm) : undefined,
    });
    armingRecorder = recorder;
    if (token !== startToken) {
      recorder.cancel();
      return;
    }
    await recorder.ready;
  } catch (error) {
    recorder?.cancel();
    if (token !== startToken) return;
    session.setStatus('idle');
    feedback(`无法使用麦克风：${describeMicError(error)}`, 'error');
    return;
  } finally {
    if (armingRecorder === recorder) armingRecorder = null;
  }

  if (token !== startToken) {
    recorder.cancel();
    return;
  }
  if (desktop) {
    try {
      await startRecording(settings, recorder.sampleRate);
    } catch {
      recorder.cancel();
      session.setStatus('idle');
      feedback('无法开始录音', 'error');
      return;
    }
  }

  activeRecorder = recorder;
  streaming = true;
  const queued = pendingChunks;
  pendingChunks = [];
  for (const data of queued) queueChunk(data);
  session.setStatus('recording');
  feedback('正在聆听…');
}

function handleChunk(ownerChunkToken: number, pcm: Int16Array) {
  if (ownerChunkToken !== chunkToken) return;
  const data = int16ToBase64(pcm);
  if (!streaming) {
    pendingChunks.push(data);
    return;
  }
  queueChunk(data);
}

function handleEnded(ownerChunkToken: number, feedback: SessionFeedback) {
  if (ownerChunkToken !== chunkToken) return;
  if (armingRecorder) {
    cancelArming(feedback);
    return;
  }
  if (!activeRecorder) return;
  feedback('麦克风已断开', 'error');
  void conclude(feedback);
}

async function conclude(feedback: SessionFeedback) {
  const recorder = activeRecorder;
  activeRecorder = null;

  const session = useSessionStore.getState();
  session.setStatus('processing');
  session.setStage('transcribe');
  session.setElapsedMs(0);

  const { token, controller } = beginProcessing();
  partialSink = (text) => {
    if (token === processingToken) {
      useSessionStore.getState().setTranscript(text);
    }
  };

  let blob: Blob | undefined;
  if (recorder) {
    try {
      blob = await recorder.stop();
    } catch {
      blob = undefined;
    }
  }
  // 最后一帧回调可能晚于 stop；先收下它，再等所有分片写完。
  streaming = false;
  const queued = pendingChunks;
  pendingChunks = [];
  for (const data of queued) queueChunk(data);
  await chunkChain.catch(() => undefined);

  let audio = '';
  if (isDesktopRuntime()) {
    const finalized = await finalizeRecording()?.catch(() => undefined);
    audio = finalized?.data ?? '';
  } else if (blob) {
    audio = await blobToDataUrl(blob);
  }

  try {
    const transcriptOutcome = await transcribe(
      audio,
      useSettingsStore.getState().models,
      controller.signal,
    );
    partialSink = null;
    guardProcessing(token);
    if (transcriptOutcome === undefined) {
      // 浏览器预览没有 Wails 绑定，用演示数据走完整条链路。
      session.setMetrics(MOCK_METRICS);
      session.setTranscript(MOCK_TRANSCRIPT);
      session.setOrganized(
        useSettingsStore.getState().desktop.showResultPreview
          ? MOCK_ORGANIZED
          : '',
      );
      saveSessionNote(MOCK_TRANSCRIPT, MOCK_ORGANIZED, MOCK_METRICS);
      return;
    }
    const asrCall = transcriptOutcome.call;
    const text = transcriptOutcome.text.trim();
    session.setMetrics({ asr: asrCall });
    session.setTranscript(text);
    session.setStage('organize');

    let result = text;
    try {
      const organizedOutcome = await organize(
        text,
        useSettingsStore.getState().models,
        controller.signal,
      );
      guardProcessing(token);
      result = organizedOutcome?.text?.trim() || text;
      const record: CallMetrics = {
        asr: asrCall,
        llm: organizedOutcome?.call,
      };
      session.setMetrics(record);
      session.setOrganized(
        useSettingsStore.getState().desktop.showResultPreview ? result : '',
      );
      saveSessionNote(text, result, record);
    } catch (error) {
      feedback(`整理失败：${describeError(error)}`, 'error');
    }
    await deliverSessionResult(result, feedback);
  } catch (error) {
    if (error instanceof TransferCancelled || token !== processingToken) {
      return;
    }
    feedback(`转写失败：${describeError(error)}`, 'error');
    await showFailureRecord();
  } finally {
    endProcessing(token, controller);
    void useCallsStore.getState().refresh();
    if (token === processingToken) {
      session.setStatus('idle');
      session.setStage(null);
    }
  }
}

function cancelAll(feedback: SessionFeedback) {
  chunkToken += 1;
  streaming = false;
  pendingChunks = [];
  startToken += 1;
  processingToken += 1;
  processingAbort?.abort();
  processingAbort = null;
  partialSink = null;

  if (armingRecorder) {
    const pending = armingRecorder;
    armingRecorder = null;
    pending.cancel();
  }
  if (activeRecorder) {
    const recorder = activeRecorder;
    activeRecorder = null;
    // cancel 而不是 stop：音频不产出，因此也不会有 blob 送去转写。
    recorder.cancel();
  }
  void chunkChain.then(() => cancelRecording()).catch(() => undefined);
  void cancelTranscriptionRequest()?.catch(() => undefined);

  const session = useSessionStore.getState();
  session.resetDraft();
  session.setStatus('idle');
  feedback('已取消这段转写');
}

async function toggle(feedback: SessionFeedback) {
  if (activeRecorder) {
    await conclude(feedback);
    return;
  }
  if (armingRecorder) {
    cancelArming(feedback);
    return;
  }
  if (useSessionStore.getState().status === 'processing') return;
  await start(feedback);
}

// overlay 窗口里唯一的录音执行器：领取 Go 发来的命令，驱动麦克风
// 与转写流水线，并把可见状态写回后端。
export function useRecorderHost() {
  const feedback = useFeedback();
  const feedbackRef = useRef(feedback);
  useEffect(() => {
    feedbackRef.current = feedback;
  }, [feedback]);

  // 电平交给 Go 广播；主窗口/悬浮球从 desktop:mic-level 读取。
  useEffect(() => {
    let last = 0;
    return subscribeMicLevel((level) => {
      const now = performance.now();
      if (now - last < 50) return;
      last = now;
      void publishMicLevel(level)?.catch(() => undefined);
    });
  }, []);

  const run = useCallback((kind: string) => {
    if (kind === 'cancel') {
      cancelAll(feedbackRef.current);
      return Promise.resolve();
    }
    return toggle(feedbackRef.current);
  }, []);

  useEffect(() => {
    let disposed = false;
    let chain: Promise<void> = Promise.resolve();
    const drain = () => {
      chain = chain
        .then(async () => {
          if (disposed) return;
          const commands = await takeSessionCommands().catch(() => []);
          for (const kind of commands) {
            if (disposed) return;
            await run(kind);
          }
        })
        .catch(() => undefined);
    };
    const unsubscribe = subscribeDesktopSessionCommand(drain);
    // 窗口刚创建时命令可能已经入队，先领一次。
    drain();
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [run]);
}
