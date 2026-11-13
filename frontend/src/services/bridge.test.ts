import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_DESKTOP_SETTINGS, DEFAULT_SETTINGS } from '@/types/models';

// 生成的绑定在测试里替换成普通对象：这里验证的是 bridge 自己的
// 请求形状与取消语义，不涉及 Wails 运行时。
const backend = vi.hoisted(() => ({
  StartRecording: vi.fn(),
  TranscribeAudio: vi.fn(),
  PolishText: vi.fn(),
  CancelTranscription: vi.fn(),
  GetConfig: vi.fn(),
}));
const controller = vi.hoisted(() => ({
  CopyText: vi.fn(),
  SetReduceMotion: vi.fn(),
  SetTranscribing: vi.fn(),
  SaveDesktopConfig: vi.fn(),
  TakeRecordingHotkeys: vi.fn(),
}));
const events = vi.hoisted(() => ({
  handlers: new Map<string, (event: { data?: unknown }) => void>(),
  On: vi.fn((name: string, handler: (event: { data?: unknown }) => void) => {
    events.handlers.set(name, handler);
    return () => events.handlers.delete(name);
  }),
}));

vi.mock('../../bindings/github.com/huangypx/shiyu/backend', () => ({
  App: backend,
}));
vi.mock('../../bindings/github.com/huangypx/shiyu/desktop', () => ({
  Controller: controller,
}));
vi.mock('@wailsio/runtime', () => ({ Events: { On: events.On } }));

import {
  cancelTranscriptionRequest,
  copyText,
  saveDesktopSettings,
  setReduceMotion,
  setTranscribing,
  startRecording,
  subscribeAsrPartial,
  subscribeDesktopHotkey,
  subscribeDesktopTransition,
  transcribe,
  TransferCancelled,
} from './bridge';

type WailsWindow = Window & { _wails?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  events.handlers.clear();
  (window as WailsWindow)._wails = { environment: { OS: 'windows' } };
  backend.TranscribeAudio.mockResolvedValue({
    text: ' 你好 ',
    call: { id: 'c1' },
  });
  backend.PolishText.mockResolvedValue({ text: '整理', call: { id: 'c2' } });
  backend.CancelTranscription.mockResolvedValue(undefined);
  controller.SetTranscribing.mockResolvedValue(undefined);
  controller.SetReduceMotion.mockResolvedValue(undefined);
});

describe('bridge', () => {
  it('预览复制使用浏览器，桌面冷启动时使用原生通道', async () => {
    (window as WailsWindow)._wails = {};
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    try {
      await copyText('预览正文');
      expect(writeText).toHaveBeenCalledWith('预览正文');
      vi.stubGlobal('chrome', { webview: { postMessage: vi.fn() } });
      await copyText('桌面正文');
      expect(controller.CopyText).toHaveBeenCalledExactlyOnceWith('桌面正文');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('补领界面加载前按下的快捷键，并按顺序处理后续按键', async () => {
    controller.TakeRecordingHotkeys.mockResolvedValueOnce([
      { mode: 'bubble', target: 'original-editor' },
    ])
      .mockResolvedValueOnce([{ mode: 'bubble', target: '' }])
      .mockResolvedValue([]);
    const callback = vi.fn();
    const unsubscribe = subscribeDesktopHotkey(callback);
    await vi.waitFor(() => expect(callback).toHaveBeenCalledOnce());
    const notify = events.handlers.get('desktop:hotkey')!;
    notify({});
    notify({});
    await vi.waitFor(() =>
      expect(controller.TakeRecordingHotkeys).toHaveBeenCalledTimes(3),
    );
    expect(callback.mock.calls).toEqual([
      ['bubble', 'original-editor'],
      ['bubble', ''],
    ]);
    unsubscribe();
  });
  it('桌面偏好通过宿主保存，开机启动开关同步到系统', async () => {
    const desktop = { ...DEFAULT_DESKTOP_SETTINGS, launchAtLogin: true };
    await saveDesktopSettings(desktop);
    expect(controller.SaveDesktopConfig).toHaveBeenCalledExactlyOnceWith(
      desktop,
    );
  });
  it('转写请求带上模型、文件名与解码后的音频', async () => {
    const outcome = await transcribe(
      'data:audio/wav;base64,QUJD',
      DEFAULT_SETTINGS,
    );

    // 去空格由调用方负责：bridge 只做搬运。
    expect(outcome?.text).toBe(' 你好 ');
    expect(backend.TranscribeAudio).toHaveBeenCalledWith({
      data: 'QUJD',
      mimeType: 'audio/wav',
      filename: 'recording.wav',
      language: DEFAULT_SETTINGS.language,
      modelId: DEFAULT_SETTINGS.activeAsrId,
    });
  });

  it('取消后立刻以 TransferCancelled 结束，不等服务商往返', async () => {
    // 后端请求一直挂着：只有本地中止生效，await 才会返回。
    backend.TranscribeAudio.mockImplementation(() => new Promise(() => {}));
    const controllerAbort = new AbortController();
    const pending = transcribe(
      'data:audio/wav;base64,QUJD',
      DEFAULT_SETTINGS,
      controllerAbort.signal,
    );

    controllerAbort.abort();

    await expect(pending).rejects.toBeInstanceOf(TransferCancelled);
  });

  it('开始录音和转写都优先使用当前模型的识别语言', async () => {
    const model = {
      ...DEFAULT_SETTINGS.asrModels[0],
      id: 'zh-asr',
      language: '中文（普通话）',
    };
    const settings = {
      ...DEFAULT_SETTINGS,
      language: 'English',
      activeAsrId: model.id,
      asrModels: [...DEFAULT_SETTINGS.asrModels, model],
    };
    await startRecording(settings);
    await transcribe('data:audio/wav;base64,QUJD', settings);
    expect(backend.StartRecording).toHaveBeenCalledWith(
      'recording.wav',
      'audio/wav',
      model.language,
      '',
    );
    expect(backend.TranscribeAudio).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: model.id, language: model.language }),
    );
  });

  it('取消动作交给后端中断在途请求，并同步菜单可用性', () => {
    void cancelTranscriptionRequest();
    void setTranscribing(true);

    expect(backend.CancelTranscription).toHaveBeenCalled();
    expect(controller.SetTranscribing).toHaveBeenCalledWith(true);
  });

  it('增量事件只转发 data.text', () => {
    const received: string[] = [];
    subscribeAsrPartial((text) => received.push(text));

    events.handlers.get('asr:partial')?.({ data: { text: '你好' } });
    events.handlers.get('asr:partial')?.({ data: null });
    events.handlers.get('asr:partial')?.({ data: { text: 42 } });

    expect(received).toEqual(['你好']);
  });

  it('把减少动态效果同步给控制器', () => {
    void setReduceMotion(true);
    expect(controller.SetReduceMotion).toHaveBeenCalledWith(true);
  });

  it('窗口切换事件只转发完整载荷', () => {
    const received: string[] = [];
    subscribeDesktopTransition((transition) =>
      received.push(transition.anchor),
    );

    const valid = {
      direction: 'expand',
      durationMs: 340,
      anchor: 'bottom-right',
      from: { x: 200, y: 300, width: 92, height: 92 },
      to: { x: 0, y: 0, width: 1000, height: 820 },
    };
    events.handlers.get('desktop:transition')?.({ data: valid });
    events.handlers.get('desktop:transition')?.({
      data: { ...valid, anchor: 'middle' },
    });
    events.handlers.get('desktop:transition')?.({
      data: { ...valid, to: { x: 0, y: 0, width: 0, height: 820 } },
    });

    expect(received).toEqual(['bottom-right']);
  });
});
