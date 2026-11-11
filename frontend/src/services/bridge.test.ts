import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/types/models';

// 生成的绑定在测试里替换成普通对象：这里验证的是 bridge 自己的
// 请求形状与取消语义，不涉及 Wails 运行时。
const backend = vi.hoisted(() => ({
  TranscribeAudio: vi.fn(),
  PolishText: vi.fn(),
  CancelTranscription: vi.fn(),
  GetConfig: vi.fn(),
}));
const controller = vi.hoisted(() => ({
  SetReduceMotion: vi.fn(),
  SetTranscribing: vi.fn(),
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
  setReduceMotion,
  setTranscribing,
  subscribeAsrPartial,
  subscribeDesktopTransition,
  transcribe,
  TransferCancelled,
} from './bridge';

type WailsWindow = Window & { _wails?: unknown };

beforeEach(() => {
  vi.clearAllMocks();
  events.handlers.clear();
  // isDesktop 用 window._wails 判断是否跑在 Wails 里。
  (window as WailsWindow)._wails = {};
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
