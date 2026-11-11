import {
  AlertDialog,
  Button,
  Select,
  TextArea,
  TextField,
} from '@radix-ui/themes';
import { Copy, Plus, Star, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ModelSettings, PolishPreset } from '@/types/models';

import {
  activePreset,
  duplicatePreset,
  MAX_PRESET_NAME,
  MAX_PRESET_PROMPT_BYTES,
  MAX_PRESETS,
  newPreset,
  presetModelOptions,
  presetValidation,
  removePreset,
  upsertPreset,
} from '../presets';
import styles from '../SettingsDialog.module.css';

type Props = {
  settings: ModelSettings;
  onChange: (patch: Partial<ModelSettings>) => void;
};

// 预设页把「有哪些整理方式」和「当前用哪一种」放在同一屏：
// 左侧列表负责排序与选择，右侧编辑名称和提示词。保存仍然走
// 弹窗底部的「保存设置」，因此这里只改 store 里的草稿。
export default function PresetSection({ settings, onChange }: Props) {
  // 空数组字面量每次渲染都是新引用，会让下面的 useMemo 失效。
  const presets = useMemo(() => settings.presets ?? [], [settings.presets]);
  const [selectedId, setSelectedId] = useState(settings.activePresetId);
  const selected =
    presets.find((preset) => preset.id === selectedId) ??
    activePreset(presets, settings.activePresetId);
  // 名称与提示词的错误就地提示，但不禁用「保存设置」：
  // 用户可能正在改别的页签，逐条提示比整份配置被拦下更清楚。
  const problem = selected
    ? presetValidation(selected)
    : '请选择或新建一个预设';

  const atLimit = presets.length >= MAX_PRESETS;

  const create = () => {
    if (atLimit) return;
    const preset = newPreset(presets.length + 1);
    onChange({ presets: upsertPreset(presets, preset) });
    setSelectedId(preset.id);
  };

  const update = (patch: Partial<PolishPreset>) => {
    if (!selected) return;
    onChange({ presets: upsertPreset(presets, { ...selected, ...patch }) });
  };

  const duplicate = () => {
    if (!selected) return;
    const next = duplicatePreset(
      presets,
      selected.id,
      () => newPreset(presets.length + 1).id,
    );
    if (next === presets) return;
    const copy = next[presets.indexOf(selected) + 1];
    onChange({ presets: next });
    setSelectedId(copy.id);
  };

  const remove = () => {
    if (!selected) return;
    const result = removePreset(presets, selected.id, settings.activePresetId);
    if (result.presets === presets) return;
    onChange({
      presets: result.presets,
      activePresetId: result.activePresetId,
    });
    setSelectedId(result.activePresetId);
  };

  const makeActive = () => {
    if (selected) onChange({ activePresetId: selected.id });
  };

  const active = useMemo(
    () => activePreset(presets, settings.activePresetId),
    [presets, settings.activePresetId],
  );
  // 「使用模型」的选项：第一项跟随全局，其余是模型池里的每一台。
  const modelOptions = useMemo(
    () => presetModelOptions(settings.llmModels, settings.activeLlmId),
    [settings.llmModels, settings.activeLlmId],
  );

  return (
    <div className={styles.form}>
      <div className={styles.presetLayout}>
        <div className={styles.presetList} role="group" aria-label="整理预设">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              aria-pressed={preset.id === selected?.id}
              className={
                preset.id === selected?.id
                  ? `${styles.presetItem} ${styles.presetItemActive}`
                  : styles.presetItem
              }
              onClick={() => setSelectedId(preset.id)}
            >
              <strong>{preset.name || '未命名预设'}</strong>
              <small>
                {preset.id === settings.activePresetId
                  ? '当前使用'
                  : '点击编辑'}
              </small>
            </button>
          ))}
        </div>

        <div className={styles.presetEditor}>
          <div className={styles.field}>
            <span className={styles.label}>
              名称
              <span className={styles.optional}>
                {' '}
                {selected?.name.trim().length ?? 0}/{MAX_PRESET_NAME}
              </span>
            </span>
            <TextField.Root
              value={selected?.name ?? ''}
              maxLength={MAX_PRESET_NAME}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="例如：精简去重"
              aria-label="预设名称"
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>
              系统提示词
              <span className={styles.optional}>
                {' '}
                {promptBytes(selected?.systemPrompt ?? '')}/
                {MAX_PRESET_PROMPT_BYTES} 字节
              </span>
            </span>
            <TextArea
              className={styles.promptArea}
              value={selected?.systemPrompt ?? ''}
              onChange={(event) => update({ systemPrompt: event.target.value })}
              placeholder="描述你想要的整理结果，例如：只去掉重复表述，保留原句顺序。"
              aria-label="系统提示词"
            />
          </div>

          <div className={styles.field}>
            <span className={styles.label}>使用模型</span>
            <Select.Root
              value={selected?.modelId ?? ''}
              onValueChange={(value) => update({ modelId: value || undefined })}
            >
              <Select.Trigger aria-label="预设使用的整理模型" />
              <Select.Content>
                {modelOptions.map((option) => (
                  <Select.Item key={option.value} value={option.value}>
                    {option.label}
                  </Select.Item>
                ))}
              </Select.Content>
            </Select.Root>
            <p className={styles.hint}>
              绑定后，这套预设固定用该模型整理；选「跟随全局」则随当前模型切换。
            </p>
          </div>

          {problem ? (
            <p className={styles.presetProblem}>{problem}</p>
          ) : (
            <p className={styles.hint}>
              提示词里的 <code>{'{{language}}'}</code> 会替换成当前识别语言；
              不写时会在末尾自动补充语言要求。
            </p>
          )}

          <div className={styles.presetActions}>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={create}
              disabled={atLimit}
            >
              <Plus size={13} /> 新建
            </Button>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={duplicate}
              disabled={!selected || atLimit}
            >
              <Copy size={13} /> 复制
            </Button>
            <Button
              size="1"
              variant="soft"
              color="gray"
              onClick={makeActive}
              disabled={!selected || selected.id === settings.activePresetId}
            >
              <Star size={13} /> 设为当前
            </Button>
            <AlertDialog.Root>
              <AlertDialog.Trigger>
                <Button
                  size="1"
                  variant="soft"
                  color="red"
                  disabled={!selected || presets.length <= 1}
                >
                  <Trash2 size={13} /> 删除
                </Button>
              </AlertDialog.Trigger>
              <AlertDialog.Content maxWidth="420px">
                <AlertDialog.Title>删除预设？</AlertDialog.Title>
                <AlertDialog.Description size="2">
                  「{selected?.name}
                  」的提示词会被移除，已经生成的整理结果不受影响。
                </AlertDialog.Description>
                <div className={styles.presetDialogActions}>
                  <AlertDialog.Cancel>
                    <Button variant="soft" color="gray">
                      取消
                    </Button>
                  </AlertDialog.Cancel>
                  <AlertDialog.Action>
                    <Button color="red" onClick={remove}>
                      删除
                    </Button>
                  </AlertDialog.Action>
                </div>
              </AlertDialog.Content>
            </AlertDialog.Root>
          </div>
        </div>
      </div>

      <p className={styles.hint}>
        {active
          ? `整理时只发送「${active.name}」的提示词；录音结束后的自动整理、浮动球和快捷键流程都使用它。`
          : '还没有可用的预设。'}
        {atLimit ? ` 已达到 ${MAX_PRESETS} 个预设的上限。` : ''}
      </p>
    </div>
  );
}

// promptBytes 与后端按字节限长保持一致，中文提示词用字符数会差三倍。
function promptBytes(text: string) {
  return new TextEncoder().encode(text).length;
}
