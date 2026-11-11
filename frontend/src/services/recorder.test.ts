import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  levelFromRms,
  smoothLevel,
  startWavRecording,
  subscribeMicLevel,
} from '@/services/recorder';

describe('levelFromRms', () => {
  it('静默与无效读数都归零', () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(-1)).toBe(0);
    expect(levelFromRms(Number.NaN)).toBe(0);
    // -60dBFS 低于噪声门：听不到的声音不该推动悬浮球。
    expect(levelFromRms(0.001)).toBe(0);
  });

  it('越过噪声门后随音量单调上升', () => {
    const quiet = levelFromRms(0.01);
    const normal = levelFromRms(0.1);
    const loud = levelFromRms(1);
    expect(quiet).toBeGreaterThan(0);
    expect(normal).toBeGreaterThan(quiet);
    expect(loud).toBe(1);
    expect(loud).toBeGreaterThan(normal);
  });
});

describe('smoothLevel', () => {
  it('起音比回落快，读数不会跳成锯齿', () => {
    const attack = smoothLevel(0, 1);
    const release = 1 - smoothLevel(1, 0);
    expect(attack).toBeGreaterThan(release);
    expect(attack).toBeLessThan(1);
  });

  it('夹取到 0–1，几乎归零时直接停住', () => {
    expect(smoothLevel(0, 5)).toBeLessThanOrEqual(1);
    expect(smoothLevel(1, -5)).toBeGreaterThanOrEqual(0);
    expect(smoothLevel(0.0001, 0)).toBe(0);
  });
});

// jsdom 没有 Web Audio，也不会有麦克风：用最小替身跑通
// 「采集回调 → 电平订阅 → 就绪 / 清理」这条链路。
type AudioHook = {
  emit: (amplitude: number) => void;
  ended: () => void;
  stopped: () => boolean;
};

let hook: AudioHook | null = null;

class FakeTrack {
  readyState = 'live';
  stopped = false;
  private listeners = new Set<() => void>();
  addEventListener(type: string, listener: () => void) {
    if (type === 'ended') this.listeners.add(listener);
  }
  removeEventListener(type: string, listener: () => void) {
    if (type === 'ended') this.listeners.delete(listener);
  }
  stop() {
    this.stopped = true;
    this.readyState = 'ended';
  }
  end() {
    for (const listener of this.listeners) listener();
  }
}

function installAudioMocks() {
  const track = new FakeTrack();
  let handler:
    | ((event: {
        inputBuffer: { getChannelData: (channel: number) => Float32Array };
      }) => void)
    | null = null;

  class FakeProcessor {
    connect() {}
    disconnect() {}
    set onaudioprocess(next: typeof handler) {
      handler = next;
    }
    get onaudioprocess() {
      return handler;
    }
  }

  class FakeContext {
    state = 'running';
    sampleRate = 48000;
    destination = {};
    createMediaStreamSource() {
      return { connect: () => undefined, disconnect: () => undefined };
    }
    createScriptProcessor() {
      return new FakeProcessor();
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }

  Object.defineProperty(window, 'AudioContext', {
    configurable: true,
    writable: true,
    value: FakeContext,
  });
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(() =>
        Promise.resolve({
          getTracks: () => [track],
          getAudioTracks: () => [track],
        }),
      ),
    },
  });

  hook = {
    emit: (amplitude) => {
      const samples = new Float32Array(2048).fill(amplitude);
      handler?.({
        inputBuffer: { getChannelData: () => samples },
      });
    },
    ended: () => track.end(),
    stopped: () => track.stopped,
  };
  return track;
}

describe('startWavRecording', () => {
  beforeEach(() => {
    installAudioMocks();
  });

  afterEach(() => {
    hook = null;
    vi.restoreAllMocks();
  });

  it('收到第一块音频之后才算就绪，并把电平推给订阅者', async () => {
    const levels: number[] = [];
    const unsubscribe = subscribeMicLevel((level) => levels.push(level));
    const recorder = await startWavRecording();

    let ready = false;
    void recorder.ready.then(() => {
      ready = true;
    });
    await Promise.resolve();
    // 还没收到音频：调用方必须继续停在「开启麦克风」。
    expect(ready).toBe(false);

    hook?.emit(0.5);
    await recorder.ready;
    expect(ready).toBe(true);
    expect(levels[levels.length - 1]).toBeGreaterThan(0);

    // 停止后电平归零，界面不会停在上一次的音量上。
    await recorder.stop();
    expect(levels[levels.length - 1]).toBe(0);
    unsubscribe();
  });

  it('设备被拔掉时通知调用方，主动停止则不通知', async () => {
    const onEnded = vi.fn();
    const recorder = await startWavRecording({ onEnded });
    hook?.emit(0.2);

    hook?.ended();
    expect(onEnded).toHaveBeenCalledTimes(1);

    // 主动收尾会解除监听，之后再触发 ended 不该重复通知。
    await recorder.stop();
    expect(hook?.stopped()).toBe(true);
    expect(onEnded).toHaveBeenCalledTimes(1);
  });

  it('取消采集会关闭轨道并清零电平', async () => {
    const levels: number[] = [];
    const unsubscribe = subscribeMicLevel((level) => levels.push(level));
    const recorder = await startWavRecording();
    hook?.emit(0.8);

    recorder.cancel();
    expect(levels[levels.length - 1]).toBe(0);
    expect(hook?.stopped()).toBe(true);
    unsubscribe();
  });
});
