import { Events } from '@wailsio/runtime';

import {
  type AsrModelConfig,
  type Backdrop,
  type CallRecord,
  DEFAULT_ACTIVE_PRESET_ID,
  DEFAULT_ASR_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_POLISH_PRESETS,
  type DesktopSettings,
  type DesktopState,
  type LlmModelConfig,
  type ModelSettings,
  type Note,
  type Platform,
  type PolishPreset,
  presetLlmModel,
} from '@/types/models';

import { App as BackendApp } from '../../bindings/github.com/huangypx/shiyu/backend';
import { Controller } from '../../bindings/github.com/huangypx/shiyu/desktop';

// 一次模型调用：产出的文本，以及这次调用本身的记录。
export type CallOutcome = { text: string; call?: CallRecord };

// 窗口切换事件里的逻辑像素矩形。字段与 Go 侧的 windowBounds
// 保持一致，前端只用 width/height 推导水滴进度。
export type WindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WindowTransitionAnchor =
  'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export type WindowTransitionPayload = {
  direction: 'shrink' | 'expand';
  // 收起是逐帧动画时长；展开是等悬浮球淡出的时长。
  durationMs: number;
  // 收起时水滴贴住主窗口的哪个角；展开不使用锚点。
  anchor: WindowTransitionAnchor;
  from: WindowBounds;
  to: WindowBounds;
};

type AudioRequest = {
  data: string;
  filename?: string;
  mimeType?: string;
  language?: string;
  // modelId 留空时后端用当前生效的 ASR 模型。
  modelId?: string;
};
type BackendConfig = {
  version: number;
  asr: {
    activeId: string;
    language?: string;
    models: AsrModelConfig[];
  };
  llm: {
    activeId: string;
    systemPrompt?: string;
    models: LlmModelConfig[];
    presets?: PolishPreset[];
    activePresetId?: string;
  };
  desktop?: DesktopSettings;
};
type BackendHistoryEntry = {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
  transcript: string;
  organized?: string;
  presetId?: string;
  presetName?: string;
  asrModelId?: string;
  llmModelId?: string;
  durationMs?: number;
  error?: string;
  calls?: CallRecord[];
};

// 浏览器预览没有 Wails 运行时；用窗口上是否存在 _wails 区分
// 桌面与纯前端，避免在普通 Vite 页面里调用生成绑定。
type WailsWindow = Window & { _wails?: unknown };

function isDesktop() {
  return (
    typeof window !== 'undefined' && Boolean((window as WailsWindow)._wails)
  );
}

function desktopOnly<T>(call: () => T): T | undefined {
  if (!isDesktop()) return undefined;
  return call();
}

export function startRecording(settings: ModelSettings) {
  // 渲染层采集 16 kHz 单声道 WAV，所有支持的 ASR 接口
  // 都接受；MediaRecorder 的 webm/mp4 容器则不行。
  return desktopOnly(() =>
    BackendApp.StartRecording(
      'recording.wav',
      'audio/wav',
      settings.language,
      '',
    ),
  );
}

export function stopRecording() {
  return desktopOnly(() => BackendApp.CancelRecording());
}

function decodeDataURL(value: string) {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]+)*,([\s\S]*)$/);
  return { mimeType: match?.[1] || 'audio/wav', data: match?.[2] || value };
}

function audioFilename(mimeType: string) {
  if (mimeType.includes('wav')) return 'recording.wav';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
    return 'recording.mp3';
  }
  return 'recording.webm';
}

// TransferCancelled 表示这次调用被用户取消了。调用方看到它应当
// 静默收尾：不提示错误、不写历史。
export class TransferCancelled extends Error {
  constructor() {
    super('transfer cancelled');
    this.name = 'TransferCancelled';
  }
}

// raceWithAbort 让等待方在用户按下取消时立刻结束。真正的服务商
// 请求由后端的 CancelTranscription 中止，这里只负责不等那个往返。
function raceWithAbort<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  // 取消之后原始请求仍会以失败收尾，提前挂一个空的失败处理，
  // 避免它变成未处理的 rejection。
  void promise.catch(() => undefined);
  if (signal.aborted) return Promise.reject(new TransferCancelled());
  const aborted = new Promise<never>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new TransferCancelled()), {
      once: true,
    });
  });
  return Promise.race([promise, aborted]);
}

// toOutcome 丢掉生成器产生的模型类，只保留 UI 类型描述的
// 纯 JSON 形状。
function toOutcome(
  result?: { text?: string; call?: unknown } | null,
): CallOutcome | undefined {
  if (!result) return undefined;
  return {
    text: result.text ?? '',
    call: result.call as CallRecord | undefined,
  };
}

export async function transcribe(
  audio: string,
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<CallOutcome | undefined> {
  if (!isDesktop()) return undefined;
  const decoded = decodeDataURL(audio);
  const request: AudioRequest = {
    data: decoded.data,
    mimeType: decoded.mimeType,
    filename: audioFilename(decoded.mimeType),
    language: settings.language,
    modelId: settings.activeAsrId,
  };
  return toOutcome(
    await raceWithAbort(BackendApp.TranscribeAudio(request), signal),
  );
}

// cancelTranscriptionRequest 让后端中断在途的转写或整理请求；没有
// 在途请求时是空操作。它和本地的 AbortController 一起用：一个负责
// 停掉服务商调用，一个负责让等待方立刻结束。
export function cancelTranscriptionRequest() {
  return desktopOnly(() => BackendApp.CancelTranscription());
}

// subscribeAsrPartial 订阅转写过程中的增量文本。载荷是累计文本，
// 直接覆盖写入即可，不需要自己拼接。
export function subscribeAsrPartial(callback: (text: string) => void) {
  if (!isDesktop()) return () => undefined;
  return Events.On('asr:partial', (event) => {
    const data: unknown = event.data;
    if (!data || typeof data !== 'object') return;
    const text = (data as { text?: unknown }).text;
    if (typeof text === 'string') callback(text);
  });
}

// setTranscribing 同步录音状态给 Go：右键菜单据此决定「取消这段
// 转写」是否可用。
export function setTranscribing(active: boolean) {
  return desktopOnly(() => Controller.SetTranscribing(active));
}

// setReduceMotion 把系统的「减少动态效果」同步给原生窗口动画。
// 原生窗口的 setFrame 读不到 CSS 媒体查询，只能由前端告诉 Go。
export function setReduceMotion(enabled: boolean) {
  return desktopOnly(() => Controller.SetReduceMotion(enabled));
}

// subscribeDesktopCancelTranscription 接收浮动球右键菜单的取消动作。
export function subscribeDesktopCancelTranscription(callback: () => void) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:cancel-transcribe', () => callback());
}

// organize 显式带上当前预设：用户可能刚在设置里切换过，而后端
// 落盘的生效预设这次调用未必已经同步。
export async function organize(
  text: string,
  settings: ModelSettings,
  signal?: AbortSignal,
): Promise<CallOutcome | undefined> {
  if (!isDesktop()) return undefined;
  const request = {
    text,
    language: settings.language,
    presetId: settings.activePresetId,
  };
  return toOutcome(await raceWithAbort(BackendApp.PolishText(request), signal));
}

// 调用日志在会话期间保存在 Go 服务里；浏览器预览
// 完全没有服务商调用，改为渲染演示记录。
export async function loadCalls() {
  if (!isDesktop()) return undefined;
  return (await BackendApp.RecentCalls()) as unknown as CallRecord[];
}

export function clearCalls() {
  return desktopOnly(() => BackendApp.ClearCalls());
}

// normalizePresets 把生成的绑定对象（class 实例）摊平成纯对象，
// 并丢掉没有 id 的条目；后端已保证提示词非空。
function normalizePresets(presets: PolishPreset[] | undefined): PolishPreset[] {
  const list = (presets ?? DEFAULT_POLISH_PRESETS)
    .map((preset) => ({
      id: preset.id,
      name: preset.name,
      systemPrompt: preset.systemPrompt,
      modelId: preset.modelId || undefined,
    }))
    .filter((preset) => preset.id);
  return list.length ? list : DEFAULT_POLISH_PRESETS.map((preset) => preset);
}

function normalizeAsrModels(
  models: AsrModelConfig[] | undefined,
): AsrModelConfig[] {
  const list = (models ?? [])
    .map((model) => ({
      id: model.id,
      name: model.name || model.model,
      provider: model.provider,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      language: model.language || undefined,
      mode:
        model.mode === 'chat' ? ('chat' as const) : ('transcriptions' as const),
      stream: model.stream === true,
    }))
    .filter((model) => model.id);
  return list.length ? list : [{ ...DEFAULT_ASR_MODEL }];
}

function normalizeLlmModels(
  models: LlmModelConfig[] | undefined,
): LlmModelConfig[] {
  const list = (models ?? [])
    .map((model) => ({
      id: model.id,
      name: model.name || model.model,
      provider: model.provider,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature,
    }))
    .filter((model) => model.id);
  return list.length ? list : [{ ...DEFAULT_LLM_MODEL }];
}

// resolveActiveId 兜一次旧配置或半途失败的迁移：选择器绝不能
// 指到一个不存在的条目。
function resolveActiveId<T extends { id: string }>(
  items: T[],
  active: string | undefined,
  fallback: string,
) {
  if (active && items.some((item) => item.id === active)) return active;
  return items[0]?.id ?? fallback;
}

export async function loadSettings(): Promise<ModelSettings | undefined> {
  if (!isDesktop()) return undefined;
  const config = (await BackendApp.GetConfig()) as unknown as BackendConfig;
  const asrModels = normalizeAsrModels(config.asr?.models);
  const llmModels = normalizeLlmModels(config.llm?.models);
  const presets = normalizePresets(config.llm?.presets);
  return {
    asrModels,
    activeAsrId: resolveActiveId(
      asrModels,
      config.asr?.activeId,
      DEFAULT_ASR_MODEL.id,
    ),
    language: config.asr?.language || '自动识别',
    llmModels,
    activeLlmId: resolveActiveId(
      llmModels,
      config.llm?.activeId,
      DEFAULT_LLM_MODEL.id,
    ),
    systemPrompt: config.llm?.systemPrompt || '',
    presets,
    activePresetId: resolveActiveId(
      presets,
      config.llm?.activePresetId,
      DEFAULT_ACTIVE_PRESET_ID,
    ),
  };
}

// setActivePreset 只同步后端的「当前生效预设」。界面已经先改了本地
// 状态，所以这里的失败不阻塞用户，下一次整理还会显式带 presetId。
export function setActivePreset(id: string) {
  return desktopOnly(() => BackendApp.SetActivePreset(id));
}

// setActiveModel 切换当前生效的 ASR / LLM 模型。它和切预设一样
// 立刻落盘：下一次录音就该用新的那一台。
export function setActiveModel(kind: 'asr' | 'llm', id: string) {
  return desktopOnly(() => BackendApp.SetActiveModel(kind, id));
}

export function saveSettings(settings: ModelSettings) {
  if (!isDesktop()) return undefined;
  const config: BackendConfig = {
    version: 2,
    asr: {
      activeId: settings.activeAsrId,
      language: settings.language,
      models: settings.asrModels,
    },
    llm: {
      activeId: settings.activeLlmId,
      systemPrompt: settings.systemPrompt,
      models: settings.llmModels,
      presets: settings.presets,
      activePresetId: settings.activePresetId,
    },
  };
  return BackendApp.SaveConfig(
    config as unknown as Parameters<typeof BackendApp.SaveConfig>[0],
  );
}

export async function loadDesktopSettings() {
  if (!isDesktop()) return undefined;
  return (await BackendApp.GetDesktopConfig()) as unknown as DesktopSettings;
}

export function saveDesktopSettings(settings: DesktopSettings) {
  return desktopOnly(() =>
    BackendApp.SaveDesktopConfig(
      settings as unknown as Parameters<typeof BackendApp.SaveDesktopConfig>[0],
    ),
  );
}

// configWarning 暴露最近一次配置读取的问题（例如 env: 密钥没设），
// 界面用它解释「为什么看起来没生效」。
export async function loadConfigWarning() {
  if (!isDesktop()) return '';
  try {
    return await BackendApp.ConfigWarning();
  } catch {
    return '';
  }
}

export async function configPath() {
  if (!isDesktop()) return '';
  try {
    return await BackendApp.ConfigPath();
  } catch {
    return '';
  }
}

export async function historyPath() {
  if (!isDesktop()) return '';
  try {
    return await BackendApp.HistoryPath();
  } catch {
    return '';
  }
}

// toNote 把后端历史记录摊平成界面用的 Note：调用明细按 kind
// 拆成 metrics，界面就不用关心数组顺序。
function toNote(entry: BackendHistoryEntry): Note {
  const metrics: Note['metrics'] = {};
  for (const call of entry.calls ?? []) {
    if (call.kind === 'asr') metrics.asr = call;
    if (call.kind === 'llm') metrics.llm = call;
  }
  return {
    id: entry.id,
    createdAt: entry.createdAt,
    title: entry.title,
    preview: entry.preview,
    transcript: entry.transcript,
    organized: entry.organized || undefined,
    presetName: entry.presetName || undefined,
    durationMs: entry.durationMs || undefined,
    error: entry.error || undefined,
    metrics,
  };
}

// toHistoryEntry 是反向转换；后端会补齐空的标题与预览。
function toHistoryEntry(
  note: Note,
  settings: ModelSettings,
): BackendHistoryEntry {
  const calls = [note.metrics?.asr, note.metrics?.llm].filter(
    (call): call is CallRecord => Boolean(call),
  );
  const preset = settings.presets.find(
    (entry) => entry.id === settings.activePresetId,
  );
  return {
    id: note.id,
    createdAt: note.createdAt,
    title: note.title,
    preview: note.preview,
    transcript: note.transcript,
    organized: note.organized ?? '',
    presetId: preset?.id ?? '',
    presetName: preset?.name ?? '',
    asrModelId: settings.activeAsrId,
    llmModelId: presetLlmModel(settings, settings.activePresetId).id,
    durationMs: note.durationMs ?? 0,
    error: note.error ?? '',
    calls,
  };
}

export async function loadHistory(limit = 100, offset = 0) {
  if (!isDesktop()) return undefined;
  const entries = (await BackendApp.ListHistory(
    limit,
    offset,
  )) as unknown as BackendHistoryEntry[];
  return entries.map(toNote);
}

export async function saveHistory(note: Note, settings: ModelSettings) {
  if (!isDesktop()) return undefined;
  const entry = toHistoryEntry(note, settings);
  const saved = (await BackendApp.SaveHistory(
    entry,
  )) as unknown as BackendHistoryEntry;
  return toNote(saved);
}

export async function deleteHistory(id: string) {
  return desktopOnly(() => BackendApp.DeleteHistory(id));
}

export async function clearHistory() {
  return desktopOnly(() => BackendApp.ClearHistory());
}

// importHistory 把旧版 localStorage 记录搬进 SQLite，返回真正
// 写入的条数；重复执行会全部命中已有 ID，结果为 0。
export async function importHistory(notes: Note[], settings: ModelSettings) {
  if (!isDesktop()) return undefined;
  const entries = notes.map((note) => toHistoryEntry(note, settings));
  return BackendApp.ImportHistory(entries);
}

export async function loadDesktopState(): Promise<DesktopState | undefined> {
  if (!isDesktop()) return undefined;
  const state = await Controller.GetState();
  return {
    mode: state.mode as DesktopState['mode'],
    hotkey: state.hotkey,
    hotkeyRegistered: state.hotkeyRegistered,
    hotkeyReason: state.hotkeyReason,
    autoPaste: state.autoPaste,
    keepBubbleOnTop: state.keepBubbleOnTop,
    restoreClipboard: state.restoreClipboard,
    canInjectText: state.canInjectText,
    platform: state.platform as Platform,
    backdrop: state.backdrop as Backdrop,
  };
}

export function enterBubble() {
  return desktopOnly(() => Controller.SetMode('bubble'));
}

export function showMainWindow() {
  return desktopOnly(() => Controller.ShowMainWindow());
}

export function hideWindow() {
  return desktopOnly(() => Controller.HideWindow());
}

export function quitApp() {
  return desktopOnly(() => Controller.Quit());
}

export function toggleDesktopMode() {
  return desktopOnly(() => Controller.ToggleMode());
}

export function saveBubblePosition() {
  return desktopOnly(() => Controller.SaveBubblePosition());
}

export function openSettingsWindow() {
  return desktopOnly(() => Controller.OpenSettings());
}

export function minimiseWindow() {
  return desktopOnly(() => Controller.MinimiseWindow());
}

export function toggleMaximiseWindow() {
  return desktopOnly(() => Controller.ToggleMaximiseWindow());
}

export async function isWindowMaximised() {
  if (!isDesktop()) return false;
  try {
    return await Controller.IsWindowMaximised();
  } catch {
    return false;
  }
}

export async function copyText(text: string) {
  if (isDesktop()) {
    await Controller.CopyText(text);
    return true;
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return false;
  }
  return false;
}

export async function pasteText(text: string) {
  if (isDesktop()) {
    await Controller.PasteText(text);
    return true;
  }
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
  return false;
}

export function configureHotkey(hotkey: string) {
  return desktopOnly(() => Controller.ConfigureHotkey(hotkey));
}

export function subscribeDesktopHotkey(callback: () => void) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:hotkey', () => callback());
}

export function subscribeDesktopSettings(callback: () => void) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:settings', () => callback());
}

export function subscribeDesktopState(callback: (state: DesktopState) => void) {
  if (!isDesktop()) return () => undefined;
  // Events.On 的回调收到的是 WailsEvent 包装对象，真实状态在 data 里；
  // 直接把它当 DesktopState 会把 runtime.mode 写成 undefined。
  return Events.On('desktop:state', (event) => {
    const data: unknown = event.data;
    if (data && typeof data === 'object') callback(data as DesktopState);
  });
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const bounds = value as Record<string, unknown>;
  return (
    typeof bounds.x === 'number' &&
    Number.isFinite(bounds.x) &&
    typeof bounds.y === 'number' &&
    Number.isFinite(bounds.y) &&
    typeof bounds.width === 'number' &&
    Number.isFinite(bounds.width) &&
    bounds.width > 0 &&
    typeof bounds.height === 'number' &&
    Number.isFinite(bounds.height) &&
    bounds.height > 0
  );
}

function parseDesktopTransition(data: unknown): WindowTransitionPayload | null {
  if (!data || typeof data !== 'object') return null;
  const payload = data as Record<string, unknown>;
  const direction = payload.direction;
  if (direction !== 'shrink' && direction !== 'expand') return null;
  if (
    typeof payload.durationMs !== 'number' ||
    !Number.isFinite(payload.durationMs) ||
    payload.durationMs < 0
  ) {
    return null;
  }
  const anchor = payload.anchor;
  if (
    anchor !== 'top-left' &&
    anchor !== 'top-right' &&
    anchor !== 'bottom-left' &&
    anchor !== 'bottom-right'
  ) {
    return null;
  }
  if (!isWindowBounds(payload.from) || !isWindowBounds(payload.to)) {
    return null;
  }
  return {
    direction,
    durationMs: payload.durationMs,
    anchor,
    from: payload.from,
    to: payload.to,
  };
}

// 原生窗口开始切换前发出。收起时载荷描述两端矩形和时长，
// 逐帧进度由前端读窗口实际宽度计算；展开只用 durationMs 等
// 悬浮球淡出，几何字段不参与绘制。
export function subscribeDesktopTransition(
  callback: (transition: WindowTransitionPayload) => void,
) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:transition', (event) => {
    const transition = parseDesktopTransition(event.data);
    if (transition) callback(transition);
  });
}

export async function blobToDataUrl(blob: Blob) {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () =>
      resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
