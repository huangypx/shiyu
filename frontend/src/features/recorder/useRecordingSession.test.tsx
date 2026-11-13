import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotesStore } from '@/features/history/notesStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { MOCK_ORGANIZED, MOCK_TRANSCRIPT } from '@/mocks/demo';
import type { WavRecorderOptions } from '@/services/recorder';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { DEFAULT_DESKTOP_SETTINGS, DEFAULT_SETTINGS } from '@/types/models';

import { useRecordingActions } from './useRecordingSession';

const bridge = vi.hoisted(() => {
  // 增量文本的订阅在模块加载时就建立了，因此这里累积监听者
  // 而不是每个用例清空，否则后续用例收不到推送。
  const partialListeners = new Set<(text: string) => void>();
  class TransferCancelled extends Error {
    constructor() {
      super('transfer cancelled');
      this.name = 'TransferCancelled';
    }
  }
  return {
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    transcribe: vi.fn(),
    organize: vi.fn(),
    finishForegroundRecording: vi.fn(),
    focusedBubbleInput: vi.fn(),
    pasteBubbleResult: vi.fn(),
    copyText: vi.fn(),
    loadCalls: vi.fn(),
    clearCalls: vi.fn(),
    blobToDataUrl: vi.fn(),
    loadSettings: vi.fn(),
    saveSettings: vi.fn(),
    loadDesktopSettings: vi.fn(),
    saveDesktopSettings: vi.fn(),
    loadDesktopState: vi.fn(),
    configureHotkey: vi.fn(),
    setActivePreset: vi.fn(),
    setActiveModel: vi.fn(),
    // 历史写入：桌面端调后端，测试里返回 undefined 让 store 保留本地副本。
    saveHistory: vi.fn(),
    loadHistory: vi.fn(),
    deleteHistory: vi.fn(),
    clearHistory: vi.fn(),
    importHistory: vi.fn(),
    subscribeDesktopHotkey: vi.fn(() => () => undefined),
    subscribeDesktopSettings: vi.fn(() => () => undefined),
    subscribeDesktopState: vi.fn(() => () => undefined),
    cancelTranscriptionRequest: vi.fn(),
    subscribeAsrPartial: vi.fn((listener: (text: string) => void) => {
      partialListeners.add(listener);
      return () => partialListeners.delete(listener);
    }),
    emitPartial: (text: string) => {
      for (const listener of partialListeners) listener(text);
    },
    TransferCancelled,
  };
});

const recorder = vi.hoisted(() => ({
  // ready 表示采集真的在跑；测试里默认已就绪，个别用例改用它
  // 观察「开启中」这个中间态。
  ready: Promise.resolve(),
  stop: vi.fn(() => Promise.resolve(new Blob(['wav']))),
  cancel: vi.fn(),
}));

// 采集器的替身形状；用显式类型而不是 typeof recorder，避免
// mock 的泛型引用到自己。
type RecorderStub = {
  ready: Promise<void>;
  stop: () => Promise<Blob>;
  cancel: () => void;
};

const startWavRecording = vi.hoisted(() =>
  vi.fn<(options?: WavRecorderOptions) => Promise<RecorderStub>>(() =>
    Promise.resolve(recorder),
  ),
);

vi.mock('@/services/bridge', () => bridge);
vi.mock('@/services/recorder', () => ({
  startWavRecording,
  // 真实实现会把 DOMException 翻成中文；测试只关心提示里
  // 有「麦克风」这类关键词。
  describeMicError: (error: unknown) =>
    error instanceof Error ? error.message : '无法开始录音',
  subscribeMicLevel: () => () => undefined,
}));

// deferred 让用例可以在「采集就绪」这一刻暂停，检查中间态。
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useRecordingSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    bridge.startRecording.mockResolvedValue(undefined);
    bridge.stopRecording.mockResolvedValue(undefined);
    bridge.blobToDataUrl.mockResolvedValue('data:audio/wav;base64,AAAA');
    bridge.loadCalls.mockResolvedValue(undefined);
    bridge.finishForegroundRecording.mockResolvedValue('pasted');
    bridge.focusedBubbleInput.mockResolvedValue('');
    bridge.pasteBubbleResult.mockResolvedValue(false);
    useDesktopStore.getState().setRuntime({ mode: 'main' });
    bridge.saveHistory.mockResolvedValue(undefined);
    bridge.loadHistory.mockResolvedValue(undefined);
    bridge.importHistory.mockResolvedValue(0);
    recorder.ready = Promise.resolve();
    recorder.stop.mockResolvedValue(new Blob(['wav']));
    startWavRecording.mockImplementation(() => Promise.resolve(recorder));

    useSettingsStore.setState({
      models: DEFAULT_SETTINGS,
      desktop: DEFAULT_DESKTOP_SETTINGS,
    });
    useSessionStore.setState({
      status: 'idle',
      stage: null,
      transcript: '',
      organized: '',
      bubbleResult: '',
      metrics: {},
      elapsedMs: 0,
      copied: false,
    });
    useNotesStore.setState({ notes: [] });
    useUiStore.setState({ notice: null });
  });

  async function recordOnce() {
    const { result } = renderHook(() => useRecordingActions());
    await act(async () => {
      await result.current.toggleRecording();
    });
    await act(async () => {
      await result.current.toggleRecording();
    });
  }

  it('浏览器预览没有服务商时回退到演示数据，并写入历史', async () => {
    bridge.transcribe.mockResolvedValue(undefined);

    await recordOnce();

    const session = useSessionStore.getState();
    expect(session.transcript).toBe(MOCK_TRANSCRIPT);
    expect(session.organized).toBe(MOCK_ORGANIZED);
    expect(session.status).toBe('idle');
    expect(useNotesStore.getState().notes).toHaveLength(1);
  });

  it('转写失败时提示错误并回到空闲状态', async () => {
    bridge.transcribe.mockRejectedValue(new Error('服务商返回 401'));

    await recordOnce();

    const notice = useUiStore.getState().notice;
    expect(notice?.tone).toBe('error');
    expect(notice?.message).toContain('转写失败');
    expect(useSessionStore.getState().status).toBe('idle');
  });

  it('成功后整理并自动粘贴', async () => {
    bridge.transcribe.mockResolvedValue({ text: '帮我把会议纪要整理一下' });
    bridge.organize.mockResolvedValue({ text: '## 会议纪要\n- 待办' });

    await recordOnce();

    const session = useSessionStore.getState();
    expect(session.transcript).toBe('帮我把会议纪要整理一下');
    expect(session.organized).toBe('## 会议纪要\n- 待办');
    expect(bridge.finishForegroundRecording).toHaveBeenCalledWith(
      '## 会议纪要\n- 待办',
      true,
    );
    expect(useNotesStore.getState().notes[0].title).toBe('会议纪要');
  });

  it('浮动录音没有输入目标时保留完整结果，点击复制才写剪贴板', async () => {
    useDesktopStore.getState().setRuntime({ mode: 'bubble' });
    useSettingsStore.getState().patchDesktop({ showResultPreview: false });
    bridge.transcribe.mockResolvedValue({ text: '两件事' });
    const text = '- 定时间\n- 发邀请';
    bridge.organize.mockResolvedValue({ text });
    await recordOnce();
    expect(useSessionStore.getState().bubbleResult).toBe(text);
    expect(useNotesStore.getState().notes[0]).toMatchObject({
      transcript: '两件事',
      organized: text,
    });
    expect(bridge.finishForegroundRecording).not.toHaveBeenCalled();
    expect(bridge.pasteBubbleResult).not.toHaveBeenCalled();
    expect(bridge.copyText).not.toHaveBeenCalled();
    const { result } = renderHook(() => useRecordingActions());
    await act(() => result.current.copyResult());
    expect(bridge.copyText).toHaveBeenCalledExactlyOnceWith(text);
  });

  it('整理完成时原生窗口已在后台，状态事件稍晚到达也能保留浮动结果', async () => {
    bridge.transcribe.mockResolvedValue({ text: '原文' });
    bridge.organize.mockResolvedValue({ text: '整理结果' });
    bridge.finishForegroundRecording.mockResolvedValue('bubble');
    await recordOnce();
    expect(useSessionStore.getState().bubbleResult).toBe('整理结果');
    expect(bridge.copyText).not.toHaveBeenCalled();
  });

  it('快捷键录音按按键时的输入框投递，空目标保留结果供复制', async () => {
    useDesktopStore.getState().setRuntime({ mode: 'bubble' });
    bridge.focusedBubbleInput.mockResolvedValue('later-editor');
    bridge.pasteBubbleResult.mockResolvedValue(true);
    bridge.transcribe.mockResolvedValue({ text: '你好。' });
    bridge.organize.mockResolvedValue({ text: '你好。' });
    const { result } = renderHook(() => useRecordingActions());
    for (const target of ['original-editor', '']) {
      await act(() => result.current.toggleRecording(target));
      await act(() => result.current.toggleRecording());
    }
    expect(bridge.focusedBubbleInput).not.toHaveBeenCalled();
    expect(bridge.pasteBubbleResult).toHaveBeenCalledExactlyOnceWith(
      '你好。',
      'original-editor',
    );
    expect(useSessionStore.getState().bubbleResult).toBe('你好。');
  });

  it.each([true, false])(
    '浮动录音保留整理全文供复制，原输入框粘贴结果为 %s',
    async (pasted) => {
      useDesktopStore.getState().setRuntime({ mode: 'bubble' });
      useSettingsStore.getState().patchDesktop({ showResultPreview: false });
      bridge.focusedBubbleInput.mockResolvedValue('original');
      bridge.pasteBubbleResult.mockResolvedValue(pasted);
      bridge.transcribe.mockResolvedValue({ text: '原文' });
      bridge.organize.mockResolvedValue({ text: '结果' });
      await recordOnce();
      expect(bridge.pasteBubbleResult).toHaveBeenCalledWith('结果', 'original');
      expect(useSessionStore.getState().bubbleResult).toBe('结果');
      expect(useUiStore.getState().notice).toBeNull();
      const { result } = renderHook(() => useRecordingActions());
      await act(() => result.current.copyResult());
      expect(bridge.copyText).toHaveBeenCalledExactlyOnceWith('结果');
      expect(bridge.finishForegroundRecording).not.toHaveBeenCalled();
    },
  );

  it('输入框查询尚未返回时就能复制，迟到的状态事件不改变原输入目标', async () => {
    const lookup = deferred();
    useDesktopStore.getState().setRuntime({ mode: 'bubble' });
    bridge.focusedBubbleInput.mockImplementation(async () => {
      await lookup.promise;
      return 'original';
    });
    bridge.transcribe.mockResolvedValue({ text: '原文' });
    bridge.organize.mockResolvedValue({ text: '结果' });
    const { result } = renderHook(() => useRecordingActions());
    await act(() => result.current.toggleRecording());
    let stopping!: Promise<void>;
    await act(async () => {
      stopping = result.current.toggleRecording();
      await vi.waitFor(() =>
        expect(useSessionStore.getState().status).toBe('idle'),
      );
    });
    expect(useSessionStore.getState()).toMatchObject({
      status: 'idle',
      bubbleResult: '结果',
    });
    expect(bridge.pasteBubbleResult).not.toHaveBeenCalled();
    await act(() => result.current.copyResult());
    expect(bridge.copyText).toHaveBeenCalledExactlyOnceWith('结果');
    useDesktopStore.getState().setRuntime({ mode: 'main' });
    await act(async () => {
      lookup.resolve();
      await stopping;
    });
    expect(bridge.pasteBubbleResult).toHaveBeenCalledExactlyOnceWith(
      '结果',
      'original',
    );
    expect(useSessionStore.getState().bubbleResult).toBe('结果');
  });

  it('前台投递返回前窗口转到后台时保留全文', async () => {
    bridge.transcribe.mockResolvedValue({ text: '原文' });
    bridge.organize.mockResolvedValue({ text: '整理结果' });
    bridge.finishForegroundRecording.mockImplementation(() => {
      useDesktopStore.getState().setRuntime({ mode: 'bubble' });
      return Promise.resolve('pasted');
    });
    await recordOnce();
    expect(useSessionStore.getState().bubbleResult).toBe('整理结果');
    expect(useUiStore.getState().notice?.message).not.toContain('粘贴');
  });

  it('开始下一次录音后，上一段迟到的焦点查询不能再粘贴或结束新录音', async () => {
    const lookup = deferred();
    useDesktopStore.getState().setRuntime({ mode: 'bubble' });
    bridge.focusedBubbleInput.mockImplementationOnce(async () => {
      await lookup.promise;
      return 'original';
    });
    bridge.transcribe.mockResolvedValue({ text: '上一段' });
    bridge.organize.mockResolvedValue({ text: '整理上一段' });
    const { result } = renderHook(() => useRecordingActions());
    await act(() => result.current.toggleRecording());
    let stopping!: Promise<void>;
    await act(async () => {
      stopping = result.current.toggleRecording();
      await vi.waitFor(() =>
        expect(useSessionStore.getState().bubbleResult).toBe('整理上一段'),
      );
    });
    await act(() => result.current.toggleRecording('next-editor'));
    await act(async () => {
      lookup.resolve();
      await stopping;
    });
    expect(bridge.pasteBubbleResult).not.toHaveBeenCalled();
    expect(useSessionStore.getState()).toMatchObject({
      status: 'recording',
      bubbleResult: '',
    });
    act(() => result.current.cancelTranscription());
  });

  it('采集确认之后才切到录音态，且麦克风先于后端会话启动', async () => {
    // 权限与设备就绪要花一点时间，这段时间界面必须停在开启中。
    const ready = deferred();
    recorder.ready = ready.promise;
    const { result } = renderHook(() => useRecordingActions());

    let starting: Promise<void> = Promise.resolve();
    await act(async () => {
      starting = result.current.toggleRecording();
      // 让启动流程推进到等待采集就绪的位置。
      await Promise.resolve();
    });
    expect(useSessionStore.getState().status).toBe('arming');
    expect(startWavRecording).toHaveBeenCalledTimes(1);
    // 麦克风还没就绪时不该先打开后端的录音会话。
    expect(bridge.startRecording).not.toHaveBeenCalled();

    await act(async () => {
      ready.resolve();
      await starting;
    });

    expect(useSessionStore.getState().status).toBe('recording');
    expect(bridge.startRecording).toHaveBeenCalledTimes(1);
  });

  it('麦克风不可用时停在空闲并提示原因，不产生转写', async () => {
    startWavRecording.mockRejectedValueOnce(new Error('麦克风权限被拒绝'));
    const { result } = renderHook(() => useRecordingActions());

    await act(async () => {
      await result.current.toggleRecording();
    });

    expect(useSessionStore.getState().status).toBe('idle');
    expect(useUiStore.getState().notice?.tone).toBe('error');
    expect(useUiStore.getState().notice?.message).toContain('麦克风');
    expect(bridge.startRecording).not.toHaveBeenCalled();
    expect(bridge.transcribe).not.toHaveBeenCalled();
  });

  it('开启麦克风期间再次触发即取消，不写历史', async () => {
    // 第一次启动挂起，模拟权限弹窗还停在屏幕上。
    let settle: (instance: RecorderStub) => void = () => undefined;
    startWavRecording.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { result } = renderHook(() => useRecordingActions());

    let starting: Promise<void> = Promise.resolve();
    act(() => {
      starting = result.current.toggleRecording();
    });
    expect(useSessionStore.getState().status).toBe('arming');

    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(useSessionStore.getState().status).toBe('idle');

    // 迟到的启动结果只能被丢弃，不能再把界面拉回录音态。
    settle(recorder);
    await act(async () => {
      await starting;
    });
    expect(useSessionStore.getState().status).toBe('idle');
    expect(recorder.cancel).toHaveBeenCalled();
    expect(bridge.transcribe).not.toHaveBeenCalled();
    expect(useNotesStore.getState().notes).toHaveLength(0);
  });

  it('录音中麦克风断开时自动结束并转写已录部分', async () => {
    bridge.transcribe.mockResolvedValue({ text: '说到一半' });
    bridge.organize.mockResolvedValue({ text: '说到一半' });
    let emitEnded: (() => void) | undefined;
    startWavRecording.mockImplementationOnce((options) => {
      emitEnded = options?.onEnded;
      return Promise.resolve(recorder);
    });
    const { result } = renderHook(() => useRecordingActions());

    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(useSessionStore.getState().status).toBe('recording');

    await act(async () => {
      emitEnded?.();
      await Promise.resolve();
    });

    expect(bridge.transcribe).toHaveBeenCalled();
    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(useSessionStore.getState().status).toBe('idle');
  });

  it('整理时带上当前生效预设，手动整理读取最新设置', async () => {
    bridge.transcribe.mockResolvedValue({ text: '记录一下' });
    bridge.organize.mockResolvedValue({ text: '整理结果' });
    useSettingsStore.setState({
      models: { ...DEFAULT_SETTINGS, activePresetId: 'meeting' },
    });

    await recordOnce();
    expect(bridge.organize).toHaveBeenLastCalledWith(
      '记录一下',
      expect.objectContaining({ activePresetId: 'meeting' }),
      expect.anything(),
    );

    // 用户在录音之后切换预设，再次手动整理必须用新的那一个。
    await act(async () => {
      await useSettingsStore.getState().selectPreset('concise');
    });
    const { result } = renderHook(() => useRecordingActions());
    await act(async () => {
      await result.current.runOrganize();
    });
    expect(bridge.organize).toHaveBeenLastCalledWith(
      '记录一下',
      expect.objectContaining({ activePresetId: 'concise' }),
      expect.anything(),
    );
  });

  it('流式增量文本直接写到原始记录面板', async () => {
    let settleTranscribe: (value: { text: string }) => void = () => undefined;
    bridge.transcribe.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleTranscribe = resolve;
        }),
    );
    bridge.organize.mockResolvedValue({ text: '整理结果' });
    const { result } = renderHook(() => useRecordingActions());

    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(useSessionStore.getState().status).toBe('recording');

    await act(async () => {
      void result.current.toggleRecording();
      // 让收尾流程推进到等待转写的位置。
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useSessionStore.getState().status).toBe('processing');
    // 还在识别：界面据此说「正在识别」，而不是「正在整理」。
    expect(useSessionStore.getState().stage).toBe('transcribe');

    const textarea = () => useSessionStore.getState().transcript;
    act(() => {
      bridge.emitPartial('你好');
    });
    expect(textarea()).toBe('你好');
    act(() => {
      bridge.emitPartial('你好世界');
    });
    expect(textarea()).toBe('你好世界');

    await act(async () => {
      settleTranscribe({ text: '你好世界' });
      await Promise.resolve();
    });
    expect(textarea()).toBe('你好世界');
  });

  it('转写完成后进入整理阶段，回到空闲时清空阶段', async () => {
    let settleOrganize: (value: { text: string }) => void = () => undefined;
    bridge.transcribe.mockResolvedValue({ text: '记录一下' });
    bridge.organize.mockImplementation(
      () =>
        new Promise((resolve) => {
          settleOrganize = resolve;
        }),
    );
    const { result } = renderHook(() => useRecordingActions());

    await act(async () => {
      await result.current.toggleRecording();
    });
    await act(async () => {
      void result.current.toggleRecording();
      await Promise.resolve();
      await Promise.resolve();
    });

    // 原文已经上屏，此刻等的是整理模型。
    await vi.waitFor(() => {
      expect(useSessionStore.getState().stage).toBe('organize');
    });
    expect(useSessionStore.getState().transcript).toBe('记录一下');

    await act(async () => {
      settleOrganize({ text: '## 整理结果' });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useSessionStore.getState().status).toBe('idle');
    expect(useSessionStore.getState().stage).toBeNull();
  });

  it('录音中取消：丢弃音频，不转写不整理也不写历史', async () => {
    const { result } = renderHook(() => useRecordingActions());
    await act(async () => {
      await result.current.toggleRecording();
    });
    expect(useSessionStore.getState().status).toBe('recording');

    act(() => {
      result.current.cancelTranscription();
    });

    expect(useSessionStore.getState().status).toBe('idle');
    // cancel 而不是 stop：不产出 blob，因此也不会有音频被送去转写。
    expect(recorder.cancel).toHaveBeenCalled();
    expect(bridge.transcribe).not.toHaveBeenCalled();
    expect(bridge.organize).not.toHaveBeenCalled();
    expect(bridge.cancelTranscriptionRequest).toHaveBeenCalled();
    expect(useNotesStore.getState().notes).toHaveLength(0);
    expect(useUiStore.getState().notice?.tone).not.toBe('error');
  });

  it('处理中取消：中断在途请求，迟到的结果与增量文本都被丢弃', async () => {
    let rejectTranscribe: (error: unknown) => void = () => undefined;
    bridge.transcribe.mockImplementation(
      () =>
        new Promise((_resolve, reject) => {
          rejectTranscribe = reject;
        }),
    );
    const { result } = renderHook(() => useRecordingActions());

    await act(async () => {
      await result.current.toggleRecording();
    });
    await act(async () => {
      void result.current.toggleRecording();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(useSessionStore.getState().status).toBe('processing');

    act(() => {
      result.current.cancelTranscription();
    });
    expect(useSessionStore.getState().status).toBe('idle');
    expect(bridge.cancelTranscriptionRequest).toHaveBeenCalled();

    // 在途请求以连接中断收尾，不能再弹一次「转写失败」。
    await act(async () => {
      rejectTranscribe(new Error('context canceled'));
      await Promise.resolve();
    });
    // 取消本身是一条中性提示，但绝不能是「转写失败」。
    expect(useUiStore.getState().notice?.tone).not.toBe('error');
    expect(useNotesStore.getState().notes).toHaveLength(0);

    // 取消之后到达的增量文本不能再写回面板。
    act(() => {
      bridge.emitPartial('迟到的文本');
    });
    expect(useSessionStore.getState().transcript).toBe('');
  });
});
