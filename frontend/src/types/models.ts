// 领域模型：后端返回的 JSON 与 UI 使用的形状在这里统一描述。
// 与后端 DTO 的差异见 services/bridge.ts，那边负责搬运。

export type ASRMode = 'transcriptions' | 'chat';

// 桌面控制器上报的宿主系统；浏览器预览为 "web"。
export type Platform = 'darwin' | 'windows' | 'linux' | 'web';

// 透明 webview 下前端可选的样式提示。"none" 保持不透明画布。
export type Backdrop = 'glass' | 'vibrancy' | 'mica' | 'none';

// AsrModelConfig 是模型池里的一台语音识别端点。id 是稳定标识，
// 切换模型、写历史都靠它；name 只用于界面展示。
export type AsrModelConfig = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  // language 为空时使用全局识别语言。
  language?: string;
  mode: ASRMode;
  // stream 让服务商边生成边返回文字，界面因此能逐字上屏。
  // 只有对话接口支持；音频仍然整段上传一次，不涉及任何切分。
  stream?: boolean;
};

// LlmModelConfig 对应文字整理的一台端点。提示词不在这里：
// 它属于预设或全局兜底，切换模型不该换掉用户写的提示词。
export type LlmModelConfig = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature?: number;
};

// 整理预设：一组用户可命名的系统提示词。名称只用于界面展示，
// id 在录音、整理和调用记录之间传递，改名不会影响已产生的记录。
export type PolishPreset = {
  id: string;
  name: string;
  systemPrompt: string;
  // modelId 让预设绑定某个整理模型；为空表示跟随全局当前模型。
  modelId?: string;
};

// ModelSettings 是设置面板编辑的完整模型配置：两个模型池 +
// 各自的当前选择 + 预设。
export type ModelSettings = {
  asrModels: AsrModelConfig[];
  activeAsrId: string;
  // 全局识别语言；单个模型的 language 优先。
  language: string;
  llmModels: LlmModelConfig[];
  activeLlmId: string;
  // 兜底提示词：预设为空时才会用到，界面上不直接编辑。
  systemPrompt: string;
  presets: PolishPreset[];
  activePresetId: string;
};

export type DesktopSettings = {
  hotkey: string;
  autoPaste: boolean;
  startInBubble: boolean;
  keepBubbleOnTop: boolean;
  showResultPreview: boolean;
  restoreClipboard: boolean;
  // 0 表示永久保留。
  historyRetentionDays: number;
};

export type DesktopState = {
  // overlay 是隐藏悬浮球后按热键叫出的底部胶囊形态。
  mode: 'main' | 'bubble' | 'overlay';
  hotkey: string;
  hotkeyRegistered: boolean;
  hotkeyReason?: string;
  autoPaste: boolean;
  keepBubbleOnTop: boolean;
  restoreClipboard: boolean;
  canInjectText: boolean;
  // bubbleHidden 表示只剩托盘：设置开关与托盘菜单都读它判断可见性。
  bubbleHidden: boolean;
  platform: Platform;
  backdrop: Backdrop;
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  audioTokens?: number;
  cachedTokens?: number;
  reasoningTokens?: number;
  providerSeconds?: number;
  raw?: string;
};

export type CallRecord = {
  id: string;
  kind: 'asr' | 'llm';
  provider: string;
  model: string;
  // modelId 指向配置里的模型；同名的不同端点靠它区分。
  modelId?: string;
  mode?: string;
  // 这次整理用的预设名称；按调用时的名字记录，之后改名不回溯。
  preset?: string;
  endpoint: string;
  startedAt: string;
  durationMs: number;
  serverMs?: number;
  finishReason?: string;
  statusCode?: number;
  requestId?: string;
  responseId?: string;
  requestBytes?: number;
  responseBytes?: number;
  audioSeconds?: number;
  usage: TokenUsage;
  ok: boolean;
  error?: string;
};

export type CallMetrics = { asr?: CallRecord; llm?: CallRecord };

// Note 是历史列表里的一条记录。它由后端 SQLite 返回，
// createdAt 是真实时间戳，不再是写死的「刚刚」。
export type Note = {
  id: string;
  createdAt: string;
  title: string;
  preview: string;
  transcript: string;
  organized?: string;
  presetName?: string;
  durationMs?: number;
  error?: string;
  metrics?: CallMetrics;
};

// 内置预设与后端 defaultPolishPresets 保持同 ID、同名称、同提示词：
// 浏览器预览靠它给出可编辑的起点，首次水合时后端返回的列表会覆盖它。
export const DEFAULT_POLISH_PRESETS: PolishPreset[] = [
  {
    id: 'default',
    name: '默认整理',
    systemPrompt:
      "You clean up dictated text. Preserve the speaker's meaning and language, fix punctuation and obvious transcription errors, remove filler words, and return only the polished text.",
  },
  {
    id: 'concise',
    name: '精简去重',
    systemPrompt:
      '你负责精简口述文本。保留原意与说话人的语言（{{language}}），删除重复表述、口头禅和语气词，把语义重复的短句合并成一句，不要新增信息，不要改写成提纲或列表，只输出整理后的正文。',
  },
  {
    id: 'markdown',
    name: 'Markdown 结构',
    systemPrompt:
      '你把口述内容整理成结构化 Markdown，语言为 {{language}}。按内容层级给出标题、要点列表和任务列表（- [ ] 待办），补全标点并删除口头禅，不添加原文没有的事实，只输出 Markdown 正文，不要用代码块包裹整体结果。',
  },
  {
    id: 'meeting',
    name: '会议纪要',
    systemPrompt:
      '你把口述内容整理成会议纪要，语言为 {{language}}。在合适的段落列出时间、参与者、讨论重点与可执行待办（- [ ]），信息缺失时直接省略对应条目，不要编造，只输出纪要正文。',
  },
];

export const DEFAULT_ACTIVE_PRESET_ID = 'default';

// 默认模型的字段值与后端 DefaultConfig() 保持一致：首次启动在
// 后端配置到位之前，界面显示的就是这一份。
export const DEFAULT_ASR_MODEL: AsrModelConfig = {
  id: 'default',
  name: '默认模型',
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini-transcribe',
  mode: 'transcriptions',
  stream: false,
};

export const DEFAULT_LLM_MODEL: LlmModelConfig = {
  id: 'default',
  name: '默认模型',
  provider: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  temperature: 0.2,
};

export const DEFAULT_SETTINGS: ModelSettings = {
  asrModels: [{ ...DEFAULT_ASR_MODEL }],
  activeAsrId: DEFAULT_ASR_MODEL.id,
  language: '中文（普通话）',
  llmModels: [{ ...DEFAULT_LLM_MODEL }],
  activeLlmId: DEFAULT_LLM_MODEL.id,
  systemPrompt: '',
  // 复制一份，避免 UI 的草稿编辑写进模块级常量。
  presets: DEFAULT_POLISH_PRESETS.map((preset) => ({ ...preset })),
  activePresetId: DEFAULT_ACTIVE_PRESET_ID,
};

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  hotkey: 'Ctrl+Shift+Space',
  autoPaste: true,
  startInBubble: false,
  keepBubbleOnTop: true,
  showResultPreview: true,
  restoreClipboard: true,
  historyRetentionDays: 0,
};

// 平台默认热键，与后端 defaultHotkeyFor 保持同一张表。
// 已保存的配置优先；这里只用于占位提示与浏览器预览。
export function defaultHotkeyFor(platform: Platform | undefined): string {
  switch (platform) {
    case 'darwin':
      return 'Option+Space';
    case 'windows':
      return 'Alt+Space';
    default:
      return 'Ctrl+Shift+Space';
  }
}

// 当前生效的模型；ID 失效时回落到第一个，与后端规则一致。
export function activeAsrModel(settings: ModelSettings): AsrModelConfig {
  return (
    settings.asrModels.find((model) => model.id === settings.activeAsrId) ??
    settings.asrModels[0] ??
    DEFAULT_ASR_MODEL
  );
}

export function activeLlmModel(settings: ModelSettings): LlmModelConfig {
  return (
    settings.llmModels.find((model) => model.id === settings.activeLlmId) ??
    settings.llmModels[0] ??
    DEFAULT_LLM_MODEL
  );
}

// 一次整理实际使用的模型：预设绑定了就用绑定的，否则跟随全局。
export function presetLlmModel(
  settings: ModelSettings,
  presetId?: string,
): LlmModelConfig {
  const preset =
    settings.presets.find((entry) => entry.id === presetId) ??
    settings.presets.find((entry) => entry.id === settings.activePresetId);
  if (preset?.modelId) {
    const bound = settings.llmModels.find(
      (model) => model.id === preset.modelId,
    );
    if (bound) return bound;
  }
  return activeLlmModel(settings);
}
