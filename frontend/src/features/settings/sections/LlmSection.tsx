import { Button, TextField } from '@radix-ui/themes';
import { Copy, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { LlmModelConfig, ModelSettings } from '@/types/models';

import {
  MAX_MODELS,
  modelListError,
  modelValidation,
  newModelId,
  removeModel,
  unbindPresetsForModel,
} from '../presets';
import styles from '../SettingsDialog.module.css';

type Props = {
  settings: ModelSettings;
  onChange: (patch: Partial<ModelSettings>) => void;
};

// LLM 页与 ASR 页同构：模型池 + 选中编辑。差别在于删除模型时
// 要顺手清掉预设里指向它的绑定，否则保存会被后端拒绝。
export default function LlmSection({ settings, onChange }: Props) {
  const models = settings.llmModels;
  const [selectedId, setSelectedId] = useState(
    settings.activeLlmId || models[0]?.id || '',
  );
  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  const update = (patch: Partial<LlmModelConfig>) => {
    if (!selected) return;
    onChange({
      llmModels: models.map((model) =>
        model.id === selected.id ? { ...model, ...patch } : model,
      ),
    });
  };

  const create = () => {
    if (models.length >= MAX_MODELS) return;
    const model: LlmModelConfig = {
      id: newModelId('llm'),
      name: `新模型 ${models.length + 1}`,
      provider: 'openai-compatible',
      baseUrl: selected?.baseUrl ?? 'https://api.openai.com/v1',
      apiKey: '',
      model: '',
      temperature: 0.2,
    };
    onChange({ llmModels: [...models, model] });
    setSelectedId(model.id);
  };

  const duplicate = () => {
    if (!selected || models.length >= MAX_MODELS) return;
    const copy: LlmModelConfig = {
      ...selected,
      id: newModelId('llm'),
      name: `${selected.name} 副本`,
    };
    onChange({ llmModels: [...models, copy] });
    setSelectedId(copy.id);
  };

  const remove = () => {
    if (!selected) return;
    const result = removeModel(models, selected.id, settings.activeLlmId);
    if (result.models === models) return;
    onChange({
      llmModels: result.models,
      activeLlmId: result.activeId,
      // 绑定已删模型的预设回到「跟随全局」，不然保存时会被校验拦下。
      presets: unbindPresetsForModel(settings.presets, selected.id),
    });
    setSelectedId(result.activeId);
  };

  const problem = selected ? modelValidation(selected) : '请选择或新建一个模型';
  const listProblem = modelListError(models);

  return (
    <div className={styles.form}>
      <div className={styles.modelList} role="group" aria-label="文字整理模型">
        {models.map((model) => {
          const boundCount = settings.presets.filter(
            (preset) => preset.modelId === model.id,
          ).length;
          return (
            <button
              key={model.id}
              type="button"
              aria-pressed={model.id === selected?.id}
              className={
                model.id === selected?.id
                  ? `${styles.presetItem} ${styles.presetItemActive}`
                  : styles.presetItem
              }
              onClick={() => setSelectedId(model.id)}
            >
              <strong>{model.name || model.model || '未命名模型'}</strong>
              <small>
                {model.model || '未填写模型'}
                {model.id === settings.activeLlmId ? ' · 当前使用' : ''}
                {boundCount ? ` · ${boundCount} 个预设绑定` : ''}
              </small>
            </button>
          );
        })}
      </div>

      {selected && (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.label}>名称</span>
              <TextField.Root
                value={selected.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="例如：便宜归纳"
                aria-label="LLM 模型名称"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>模型</span>
              <TextField.Root
                value={selected.model}
                onChange={(event) => update({ model: event.target.value })}
                placeholder="gpt-4o-mini"
                aria-label="LLM 模型 ID"
              />
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>接口地址</span>
            <TextField.Root
              value={selected.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              aria-label="LLM 接口地址"
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>
              API Key <span className={styles.optional}>可选</span>
            </span>
            <TextField.Root
              type="password"
              value={selected.apiKey}
              onChange={(event) => update({ apiKey: event.target.value })}
              placeholder="sk-… 或 env:OPENAI_API_KEY"
              autoComplete="off"
              aria-label="LLM API Key"
            />
          </div>
          <div className={styles.field}>
            <span className={styles.label}>
              温度 <span className={styles.optional}>0 – 2</span>
            </span>
            <TextField.Root
              type="number"
              value={String(selected.temperature ?? 0.2)}
              onChange={(event) =>
                update({ temperature: Number(event.target.value) })
              }
              aria-label="LLM 温度"
            />
          </div>
          {problem ? (
            <p className={styles.presetProblem}>{problem}</p>
          ) : (
            <p className={styles.hint}>
              本地 Ollama 可把地址设为 http://127.0.0.1:11434/v1，API key 留空。
              整理时发送的系统提示词在「整理预设」页签里编辑。
            </p>
          )}
        </>
      )}

      <div className={styles.presetActions}>
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={create}
          disabled={models.length >= MAX_MODELS}
        >
          <Plus size={13} /> 新建
        </Button>
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={duplicate}
          disabled={!selected || models.length >= MAX_MODELS}
        >
          <Copy size={13} /> 复制
        </Button>
        <Button
          size="1"
          variant="soft"
          color="gray"
          onClick={() => selected && onChange({ activeLlmId: selected.id })}
          disabled={!selected || selected.id === settings.activeLlmId}
        >
          <Star size={13} /> 设为当前
        </Button>
        <Button
          size="1"
          variant="soft"
          color="red"
          onClick={remove}
          disabled={!selected || models.length <= 1}
        >
          <Trash2 size={13} /> 删除
        </Button>
      </div>

      {listProblem && <p className={styles.presetProblem}>{listProblem}</p>}
      <p className={styles.hint}>
        「整理预设」可以为每套提示词单独绑定模型：常用预设走便宜模型，
        重要场景再切到强模型。
      </p>
    </div>
  );
}
