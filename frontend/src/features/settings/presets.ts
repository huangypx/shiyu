import type { LlmModelConfig, PolishPreset } from '@/types/models';

// 预设的编辑规则都放在这里：表单要即时校验，store 要安全地增删改，
// 两边共用同一套判断，避免界面允许的状态被后端拒绝。
export const MAX_PRESETS = 24;
export const MAX_PRESET_NAME = 60;
// 与后端 maxPolishPromptBytes 对齐：提示词按 UTF-8 字节数限长。
export const MAX_PRESET_PROMPT_BYTES = 8000;
export const MAX_MODELS = 24;
export const MAX_MODEL_NAME = 60;
export const LANGUAGE_PLACEHOLDER = '{{language}}';

// newPreset 生成一个未命名的空预设，用户填好名称与提示词后才能保存。
// crypto.randomUUID 只在安全上下文可用，预览与旧 WebView 里退回时间戳。
export function newPreset(index: number): PolishPreset {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id: `preset-${random}`,
    name: `新预设 ${index}`,
    systemPrompt: '',
  };
}

// newModelId 与 newPreset 用同一套随机 ID 策略；模型 ID 会写进历史，
// 因此不能复用「默认模型」这类可读名字。
export function newModelId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${random}`;
}

export function upsertPreset(
  presets: PolishPreset[],
  next: PolishPreset,
): PolishPreset[] {
  const exists = presets.some((preset) => preset.id === next.id);
  if (!exists) {
    if (presets.length >= MAX_PRESETS) return presets;
    return [...presets, next];
  }
  return presets.map((preset) => (preset.id === next.id ? next : preset));
}

// duplicatePreset 复制一份并插入到原预设后面，名字加“副本”后缀，
// 方便用户在一个可用的起点上改动。达到上限时返回原列表。
export function duplicatePreset(
  presets: PolishPreset[],
  id: string,
  makeId: () => string = () => newPreset(presets.length + 1).id,
): PolishPreset[] {
  if (presets.length >= MAX_PRESETS) return presets;
  const index = presets.findIndex((preset) => preset.id === id);
  if (index < 0) return presets;
  const source = presets[index];
  const copy: PolishPreset = {
    id: makeId(),
    name: `${source.name} 副本`,
    systemPrompt: source.systemPrompt,
    modelId: source.modelId,
  };
  return [...presets.slice(0, index + 1), copy, ...presets.slice(index + 1)];
}

// removePreset 至少保留一个预设并返回新的生效 ID：删掉的正好是生效项
// 时，落到删除位置之后的那一项，再不行就落到第一项。
export function removePreset(
  presets: PolishPreset[],
  id: string,
  activeId: string,
): { presets: PolishPreset[]; activePresetId: string } {
  if (presets.length <= 1) {
    return { presets, activePresetId: activeId };
  }
  const index = presets.findIndex((preset) => preset.id === id);
  if (index < 0) return { presets, activePresetId: activeId };
  const next = presets.filter((preset) => preset.id !== id);
  if (activeId !== id) return { presets: next, activePresetId: activeId };
  const fallback = next[Math.min(index, next.length - 1)];
  return { presets: next, activePresetId: fallback.id };
}

// presetValidation 在保存前给出可读的中文原因；返回 null 表示这一条
// 可以提交。逐条校验，编辑器只展示当前预设的问题。
export function presetValidation(preset: PolishPreset): string | null {
  if (!preset.name.trim()) return '请填写预设名称';
  if ([...preset.name.trim()].length > MAX_PRESET_NAME) {
    return `名称不能超过 ${MAX_PRESET_NAME} 个字`;
  }
  if (!preset.systemPrompt.trim()) return '请填写系统提示词';
  if (promptBytes(preset.systemPrompt) > MAX_PRESET_PROMPT_BYTES) {
    return `提示词不能超过 ${MAX_PRESET_PROMPT_BYTES} 字节`;
  }
  return null;
}

// presetListError 检查整个列表：重复 ID 与空列表后端都会拒绝，
// 提前在界面上说清楚比等保存失败更有用。
export function presetListError(presets: PolishPreset[]): string | null {
  if (!presets.length) return '至少保留一个预设';
  if (presets.length > MAX_PRESETS) return `最多只能有 ${MAX_PRESETS} 个预设`;
  const ids = new Set<string>();
  for (const preset of presets) {
    if (ids.has(preset.id)) return '预设 ID 重复，请重新创建';
    ids.add(preset.id);
    const problem = presetValidation(preset);
    if (problem) return problem;
  }
  return null;
}

export function activePreset(
  presets: PolishPreset[],
  activeId: string,
): PolishPreset | undefined {
  return presets.find((preset) => preset.id === activeId) ?? presets[0];
}

// modelValidation 校验一台模型。baseUrl 只做形状检查，真正的连通性
// 由「测试连接」负责，避免保存设置时被网络问题挡住。
export function modelValidation(model: {
  name: string;
  baseUrl: string;
  model: string;
}): string | null {
  if (!model.name.trim()) return '请填写模型名称';
  if ([...model.name.trim()].length > MAX_MODEL_NAME) {
    return `名称不能超过 ${MAX_MODEL_NAME} 个字`;
  }
  const url = model.baseUrl.trim();
  if (!url) return '请填写接口地址';
  if (!/^https?:\/\//i.test(url))
    return '接口地址必须以 http:// 或 https:// 开头';
  if (!model.model.trim()) return '请填写模型 ID';
  return null;
}

export function modelListError(models: { id: string }[]): string | null {
  if (!models.length) return '至少保留一个模型';
  if (models.length > MAX_MODELS) return `最多只能有 ${MAX_MODELS} 个模型`;
  const ids = new Set<string>();
  for (const model of models) {
    if (ids.has(model.id)) return '模型 ID 重复，请重新创建';
    ids.add(model.id);
  }
  return null;
}

// removeModel 与 removePreset 同构：至少留一台，删掉的正好是
// 当前使用的那台时，落到相邻的一台。
export function removeModel<T extends { id: string }>(
  models: T[],
  id: string,
  activeId: string,
): { models: T[]; activeId: string } {
  if (models.length <= 1) return { models, activeId };
  const index = models.findIndex((model) => model.id === id);
  if (index < 0) return { models, activeId };
  const next = models.filter((model) => model.id !== id);
  if (activeId !== id) return { models: next, activeId };
  const fallback = next[Math.min(index, next.length - 1)];
  return { models: next, activeId: fallback.id };
}

// unbindPresetsForModel 在删掉一台整理模型时清空指向它的绑定，
// 否则预设会引用一个不存在的 ID，保存时被后端拒绝。
export function unbindPresetsForModel(
  presets: PolishPreset[],
  modelId: string,
): PolishPreset[] {
  if (!presets.some((preset) => preset.modelId === modelId)) return presets;
  return presets.map((preset) =>
    preset.modelId === modelId ? { ...preset, modelId: undefined } : preset,
  );
}

// presetModelOptions 给「使用模型」下拉生成选项：第一项是跟随全局。
export function presetModelOptions(
  models: LlmModelConfig[],
  activeModelId: string,
): { value: string; label: string }[] {
  const active = models.find((model) => model.id === activeModelId);
  return [
    {
      value: '',
      label: `跟随全局${active ? `（${active.name}）` : ''}`,
    },
    ...models.map((model) => ({ value: model.id, label: model.name })),
  ];
}

// 按 UTF-8 字节数计算长度，与 Go 侧的 len(string) 保持一致；
// 中文提示词用字符数算会差出三倍。
function promptBytes(text: string) {
  return new TextEncoder().encode(text).length;
}
