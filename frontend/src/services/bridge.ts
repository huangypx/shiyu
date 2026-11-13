import { Events } from '@wailsio/runtime';

import {
  type AsrModelConfig,
  type Backdrop,
  type CallMetrics,
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

// SessionSnapshot 是 Go 侧会话状态在前端的形状。窗口只读它，
// Go 流水线负责写入。
export type SessionSnapshot = {
  status: 'idle' | 'arming' | 'recording' | 'processing';
  stage: 'transcribe' | 'organize' | null;
  transcript: string;
  organized: string;
  metrics: CallMetrics;
  stageStartedAt: number;
  revision: number;
  host?: string;
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
    bubbleHidden: state.bubbleHidden,
    closeRequested: state.closeRequested,
    platform: state.platform as Platform,
    backdrop: state.backdrop as Backdrop,
  };
}

export function enterBubble() {
  return desktopOnly(() => Controller.EnterBubble());
}

export function showMainWindow() {
  return desktopOnly(() => Controller.ShowMainWindow());
}

export function hideWindow() {
  return desktopOnly(() => Controller.HideWindow());
}

// setBubbleHidden 切换并持久化「仅保留托盘」的隐藏态：隐藏后全局
// 热键叫出底部胶囊，恢复时回到悬浮球。无托盘的平台会拒绝隐藏。
export function setBubbleHidden(hidden: boolean) {
  return desktopOnly(() => Controller.SetBubbleHidden(hidden));
}

export function quitApp() {
  return desktopOnly(() => Controller.Quit());
}

// requestClose 请求关闭主窗口：默认弹出确认框，已记住偏好时直接执行。
export function requestClose() {
  return desktopOnly(() => Controller.RequestClose());
}

// resolveWindowClose 提交关闭确认框的选择；remember 时写回 CloseAction。
export function resolveWindowClose(
  action: 'background' | 'quit' | 'cancel',
  remember: boolean,
) {
  return desktopOnly(() => Controller.ResolveClose(action, remember));
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

function toSessionSnapshot(value: unknown): SessionSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const state = value as Record<string, unknown>;
  const status = state.status;
  if (
    status !== 'idle' &&
    status !== 'arming' &&
    status !== 'recording' &&
    status !== 'processing'
  ) {
    return null;
  }
  const stageValue = state.stage;
  const stage =
    stageValue === 'transcribe' || stageValue === 'organize'
      ? stageValue
      : null;
  return {
    status,
    stage,
    transcript: typeof state.transcript === 'string' ? state.transcript : '',
    organized: typeof state.organized === 'string' ? state.organized : '',
    metrics: (state.metrics as CallMetrics | undefined) ?? {},
    stageStartedAt:
      typeof state.stageStartedAt === 'number' ? state.stageStartedAt : 0,
    revision: typeof state.revision === 'number' ? state.revision : 0,
    host: typeof state.host === 'string' ? state.host : undefined,
  };
}

export async function getSession(): Promise<SessionSnapshot | undefined> {
  if (!isDesktop()) return undefined;
  return toSessionSnapshot(await Controller.GetSession()) ?? undefined;
}

export function publishSession(snapshot: SessionSnapshot) {
  return desktopOnly(() =>
    Controller.PublishSession({
      status: snapshot.status,
      stage: snapshot.stage ?? '',
      transcript: snapshot.transcript,
      organized: snapshot.organized,
      metrics: snapshot.metrics,
      stageStartedAt: snapshot.stageStartedAt,
      revision: 0,
      host: '',
    }),
  );
}

export function toggleDesktopRecording() {
  return desktopOnly(() => Controller.ToggleRecording());
}

export function cancelDesktopTranscription() {
  return desktopOnly(() => Controller.CancelTranscription());
}

export function organizeSession() {
  return desktopOnly(() => Controller.OrganizeSession());
}

export async function takeMainCommands(): Promise<string[]> {
  if (!isDesktop()) return [];
  return Controller.TakeMainCommands();
}

export function publishMicLevel(level: number) {
  return desktopOnly(() => Controller.PublishMicLevel(level));
}

export function applyDesktopSettings() {
  return desktopOnly(() => Controller.ApplyDesktopSettings());
}

export function subscribeDesktopSession(
  callback: (snapshot: SessionSnapshot) => void,
) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:session', (event) => {
    const snapshot = toSessionSnapshot(event.data);
    if (snapshot) callback(snapshot);
  });
}

export function subscribeDesktopNotice(
  callback: (message: string, tone: 'success' | 'error') => void,
) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:notice', (event) => {
    const data = event.data as
      { message?: unknown; tone?: unknown } | undefined;
    if (!data || typeof data.message !== 'string') return;
    callback(data.message, data.tone === 'error' ? 'error' : 'success');
  });
}

export function subscribeDesktopMicLevel(callback: (level: number) => void) {
  if (!isDesktop()) return () => undefined;
  return Events.On('desktop:mic-level', (event) => {
    const data = event.data as { level?: unknown } | undefined;
    if (data && typeof data.level === 'number' && Number.isFinite(data.level)) {
      callback(data.level);
    }
  });
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
