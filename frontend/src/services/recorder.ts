// 把麦克风音频录成 16 kHz 单声道 16 位 WAV。
//
// MediaRecorder 只能产出 webm/opus（Chromium）或 mp4/aac（WebKit），
// 而本应用对接的 ASR 端点只接受 wav 或 mp3——对话式接口
// 更是直接拒绝其他格式。从 Web Audio 图里采集 PCM
// 并写出 RIFF 头，只保留一种在所有引擎上都能用的
// 格式。

export type WavRecorder = {
  // 采集确认在跑（至少收到过一块音频）之后才 resolve，
  // 调用方据此把界面切成录音态，避免「看着在录其实还没开麦」。
  ready: Promise<void>;
  // AudioContext 的原生采样率；Go 收尾时统一重采样到 16 kHz。
  sampleRate: number;
  // 桌面端把 PCM 分片交给后端，不再在本地攒整段音频；
  // 浏览器预览没有 onChunk，仍返回 WAV Blob。
  stop: () => Promise<Blob | undefined>;
  cancel: () => void;
};

export type WavRecorderOptions = {
  // 设备被拔掉或权限被撤销时触发；主动 stop/cancel 不算。
  // 没有它，录音中拔掉麦克风只能等用户手动点结束。
  onEnded?: () => void;
  // 每块 Int16 单声道 PCM；提供它即进入流式模式，停止时不再
  // 在内存里拼整段 WAV。
  onChunk?: (pcm: Int16Array) => void;
};

// 音量订阅：采集器把归一化后的电平推给界面，
// 界面据此缩放浮动球与波形。用订阅而不是 React 状态，
// 是因为每秒几十次的更新不该触发重渲染。
export type MicLevelListener = (level: number) => void;

const TARGET_SAMPLE_RATE = 16000;
// 2048 帧在 48 kHz 下约 43ms 一次回调，音量约 23Hz 更新：
// 足够顺滑，又不比 4096 多出可感知的 CPU 开销。
const BUFFER_SIZE = 2048;
// -50dBFS 以下当作静默，噪声门让球在安静时不抖动。
const FLOOR_DB = -50;
// 低音量人声在 0.8 次幂后更接近视觉上的「一半」，
// 否则轻声说话时球几乎不动。
const LEVEL_CURVE = 0.8;
// 起音快、回落慢：说话时立刻放大，停顿后缓缓收回。
const ATTACK = 0.55;
const RELEASE = 0.18;

const levelListeners = new Set<MicLevelListener>();
let currentLevel = 0;

export function subscribeMicLevel(listener: MicLevelListener) {
  levelListeners.add(listener);
  // 新订阅者立刻拿到当前电平，避免切换页面后先画一帧 0。
  listener(currentLevel);
  return () => {
    levelListeners.delete(listener);
  };
}

function publishLevel(level: number) {
  currentLevel = level;
  for (const listener of levelListeners) listener(level);
}

// levelFromRms 把 RMS 幅度换算成 0–1 的显示电平。
// 对数刻度才有「一半音量」的直觉：线性幅度在 -6dB
// 处已经接近 0.5，看起来却是满格。
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  const db = 20 * Math.log10(rms);
  if (db <= FLOOR_DB) return 0;
  // 0dBFS 取 1；高于它的读数（部分引擎会略微超过）夹到 1。
  const normalized = Math.min(1, (db - FLOOR_DB) / -FLOOR_DB);
  return Math.min(1, Math.max(0, normalized)) ** LEVEL_CURVE;
}

// smoothLevel 做非对称平滑：起音快、回落慢，读数不会在
// 音节之间跳成锯齿。
export function smoothLevel(previous: number, next: number): number {
  const target = Math.min(1, Math.max(0, next));
  const factor = target > previous ? ATTACK : RELEASE;
  const value = previous + (target - previous) * factor;
  // 低于千分之一就归零，否则会永远停在肉眼看不见的小数上。
  return value < 0.001 ? 0 : value;
}

function measureRms(samples: Float32Array) {
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return samples.length ? Math.sqrt(sum / samples.length) : 0;
}

// describeMicError 把浏览器抛出的 DOMException 翻译成能照着做的
// 中文提示：原文只有 "Permission denied" 这类英文短语。
export function describeMicError(error: unknown): string {
  const name =
    error && typeof error === 'object' && 'name' in error
      ? String(error.name)
      : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '麦克风权限被拒绝，请在系统设置里允许后重试';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '没有找到可用的麦克风';
    case 'NotReadableError':
    case 'AbortError':
      return '麦克风正被其他应用占用';
    default:
      break;
  }
  if (error instanceof Error && error.message) return error.message;
  return '无法开始录音';
}

export async function startWavRecording(
  options: WavRecorderOptions = {},
): Promise<WavRecorder> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('当前环境不支持麦克风采集');
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const AudioContextCtor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioContextCtor) {
    stream.getTracks().forEach((track) => track.stop());
    throw new Error('当前环境不支持 Web Audio');
  }

  const context = new AudioContextCtor();
  await context.resume().catch(() => undefined);

  const source = context.createMediaStreamSource(stream);
  // ScriptProcessorNode 已废弃，但它是不额外提供 AudioWorklet
  // 模块时，Chromium 和 WebKit 共有的唯一 PCM 采集方式。
  const processor = context.createScriptProcessor(BUFFER_SIZE, 1, 1);
  const streaming = options.onChunk !== undefined;
  const chunks: Float32Array[] = [];
  let smoothed = 0;
  let disposed = false;
  let resolveReady = () => undefined as void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  processor.onaudioprocess = (event) => {
    if (disposed) return;
    const samples = new Float32Array(event.inputBuffer.getChannelData(0));
    if (streaming) options.onChunk?.(encodePcm16(samples));
    else chunks.push(samples);
    smoothed = smoothLevel(smoothed, levelFromRms(measureRms(samples)));
    publishLevel(smoothed);
    // 回调本身才是证据：设备静音时同样会送回调（只有静音电平），
    // 那也算「能录」，只是没有声音。
    resolveReady();
  };
  source.connect(processor);
  // 该节点只在连接到 destination 时运行；输出保持
  // 静音，因为不往输出缓冲写任何数据。
  processor.connect(context.destination);

  const sampleRate = context.sampleRate;
  const track = stream.getAudioTracks()[0];

  const handleEnded = () => {
    // 主动收尾会先置 disposed，这里只处理设备侧的意外结束。
    if (disposed) return;
    options.onEnded?.();
  };
  track?.addEventListener('ended', handleEnded);

  const teardown = () => {
    if (disposed) return;
    disposed = true;
    track?.removeEventListener('ended', handleEnded);
    processor.onaudioprocess = null;
    try {
      processor.disconnect();
    } catch {
      /* 已经断开连接 */
    }
    try {
      source.disconnect();
    } catch {
      /* 已经断开连接 */
    }
    stream.getTracks().forEach((item) => item.stop());
    void context.close().catch(() => undefined);
    publishLevel(0);
    // 采集提前结束时也要解除等待，调用方不能再卡在 ready 上。
    resolveReady();
  };

  // 个别引擎不会立刻触发 onaudioprocess：上下文已在跑且轨道
  // 仍存活时，等半秒就当作可以开始，避免按钮卡在「开启中」；
  // 设备真不可用时 getUserMedia 或轨道 ended 会先报错。
  const readyGuard = window.setTimeout(() => {
    const live = track?.readyState === 'live';
    if (!disposed && context.state === 'running' && live) {
      resolveReady();
    }
  }, 500);

  return {
    ready,
    sampleRate,
    // 采集是同步结束的，返回 Promise 只是为了与调用方
    // 的 await 习惯保持一致。
    stop: () => {
      window.clearTimeout(readyGuard);
      teardown();
      if (streaming) return Promise.resolve(undefined);
      return Promise.resolve(encodeWav(mergeChunks(chunks), sampleRate));
    },
    cancel: () => {
      window.clearTimeout(readyGuard);
      teardown();
      chunks.length = 0;
    },
  };
}

function encodePcm16(samples: Float32Array): Int16Array {
  const output = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    output[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
  }
  return output;
}

function mergeChunks(chunks: Float32Array[]) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

function resample(input: Float32Array, inputRate: number, outputRate: number) {
  if (outputRate >= inputRate) return input;
  const ratio = inputRate / outputRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j += 1) sum += input[j];
    output[i] = end > start ? sum / (end - start) : 0;
  }
  return output;
}

function encodeWav(samples: Float32Array, inputRate: number) {
  const rate = Math.min(inputRate, TARGET_SAMPLE_RATE);
  const data = resample(samples, inputRate, rate);
  const buffer = new ArrayBuffer(44 + data.length * 2);
  const view = new DataView(buffer);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + data.length * 2, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块大小
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // 字节率
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeAscii(view, 36, 'data');
  view.setUint32(40, data.length * 2, true);

  let offset = 44;
  for (let i = 0; i < data.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, data[i]));
    view.setInt16(
      offset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    offset += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

function writeAscii(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) {
    view.setUint8(offset + i, value.charCodeAt(i));
  }
}
