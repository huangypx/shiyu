import { Button, Select, TextField } from '@radix-ui/themes';
import { Copy, Plus, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';

import type { ASRMode, AsrModelConfig, ModelSettings } from '@/types/models';

import {
  MAX_MODELS,
  modelListError,
  modelValidation,
  newModelId,
  removeModel,
} from '../presets';
import styles from '../SettingsDialog.module.css';
import ToggleRow from './ToggleRow';

type Props = {
  settings: ModelSettings;
  onChange: (patch: Partial<ModelSettings>) => void;
};

// ASR 页从「一组字段」变成「模型池 + 选中编辑」：不同服务商、
// 不同价位的转写端点可以并存，录音时用当前选中的那一台。
export default function AsrSection({ settings, onChange }: Props) {
  const models = settings.asrModels;
  const [selectedId, setSelectedId] = useState(
    settings.activeAsrId || models[0]?.id || '',
  );
  const selected = models.find((model) => model.id === selectedId) ?? models[0];

  const update = (patch: Partial<AsrModelConfig>) => {
    if (!selected) return;
    onChange({
      asrModels: models.map((model) =>
        model.id === selected.id ? { ...model, ...patch } : model,
      ),
    });
  };

  const create = () => {
    if (models.length >= MAX_MODELS) return;
    const model: AsrModelConfig = {
      id: newModelId('asr'),
      name: `新模型 ${models.length + 1}`,
      provider: 'openai-compatible',
      baseUrl: selected?.baseUrl ?? 'https://api.openai.com/v1',
      apiKey: '',
      model: '',
      mode: 'transcriptions',
      stream: false,
    };
    onChange({ asrModels: [...models, model] });
    setSelectedId(model.id);
  };

  const duplicate = () => {
    if (!selected || models.length >= MAX_MODELS) return;
    const copy: AsrModelConfig = {
      ...selected,
      id: newModelId('asr'),
      name: `${selected.name} 副本`,
    };
    onChange({ asrModels: [...models, copy] });
    setSelectedId(copy.id);
  };

  const remove = () => {
    if (!selected) return;
    const result = removeModel(models, selected.id, settings.activeAsrId);
    if (result.models === models) return;
    onChange({ asrModels: result.models, activeAsrId: result.activeId });
    setSelectedId(result.activeId);
  };

  const problem = selected ? modelValidation(selected) : '请选择或新建一个模型';
  const listProblem = modelListError(models);

  return (
    <div className={styles.form}>
      <div className={styles.modelList} role="group" aria-label="语音识别模型">
        {models.map((model) => (
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
              {model.id === settings.activeAsrId ? ' · 当前使用' : ''}
            </small>
          </button>
        ))}
      </div>

      {selected && (
        <>
          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.label}>名称</span>
              <TextField.Root
                value={selected.name}
                onChange={(event) => update({ name: event.target.value })}
                placeholder="例如：便宜转写"
                aria-label="ASR 模型名称"
              />
            </div>
            <div className={styles.field}>
              <span className={styles.label}>模型</span>
              <TextField.Root
                value={selected.model}
                onChange={(event) => update({ model: event.target.value })}
                placeholder="whisper-1"
                aria-label="ASR 模型 ID"
              />
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.label}>接口地址</span>
            <TextField.Root
              value={selected.baseUrl}
              onChange={(event) => update({ baseUrl: event.target.value })}
              aria-label="ASR 接口地址"
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
              aria-label="ASR API Key"
            />
            <p className={styles.hint}>
              填 <code>env:变量名</code> 或 <code>file:/绝对路径</code>
              可以不在配置文件里写明文密钥。
            </p>
          </div>
          <div className={styles.row}>
            <div className={styles.field}>
              <span className={styles.label}>接口类型</span>
              <Select.Root
                value={selected.mode}
                onValueChange={(value) =>
                  // 流式只有对话接口支持，切回转写接口时顺手关掉，
                  // 免得下次切回来是一个界面没解释过的开启状态。
                  update(
                    value === 'chat'
                      ? { mode: value }
                      : { mode: value as ASRMode, stream: false },
                  )
                }
              >
                <Select.Trigger aria-label="ASR 接口类型" />
                <Select.Content>
                  <Select.Item value="transcriptions">转写接口</Select.Item>
                  <Select.Item value="chat">对话接口（音频输入）</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
            <div className={styles.field}>
              <span className={styles.label}>识别语言（留空跟随全局）</span>
              <Select.Root
                value={selected.language || ''}
                onValueChange={(value) =>
                  update({ language: value || undefined })
                }
              >
                <Select.Trigger aria-label="ASR 模型语言" />
                <Select.Content>
                  <Select.Item value="">
                    跟随全局（{settings.language}）
                  </Select.Item>
                  <Select.Item value="中文（普通话）">
                    中文（普通话）
                  </Select.Item>
                  <Select.Item value="English">English</Select.Item>
                  <Select.Item value="日本語">日本語</Select.Item>
                  <Select.Item value="自动识别">自动识别</Select.Item>
                </Select.Content>
              </Select.Root>
            </div>
          </div>
          <ToggleRow
            title="流式返回转写文字"
            description={
              selected.mode === 'chat'
                ? '识别结果边生成边显示，不必等整段返回；音频仍然整段上传一次，识别内容不变。'
                : '仅对话接口支持流式返回；转写接口各网关行为不一，保持关闭。'
            }
            checked={selected.stream === true}
            onCheckedChange={(checked) => update({ stream: checked })}
            disabled={selected.mode !== 'chat'}
          />
          {problem ? (
            <p className={styles.presetProblem}>{problem}</p>
          ) : (
            <p className={styles.hint}>
              {selected.mode === 'chat'
                ? '对话接口把音频作为 input_audio 发给 /chat/completions，适用于多模态语音模型，仅支持 wav / mp3。'
                : '转写接口以 multipart 上传到 /audio/transcriptions，适用于 OpenAI、Groq 等 Whisper 兼容服务。'}
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
          onClick={() => selected && onChange({ activeAsrId: selected.id })}
          disabled={!selected || selected.id === settings.activeAsrId}
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

      <div className={styles.field}>
        <span className={styles.label}>全局识别语言</span>
        <Select.Root
          value={settings.language}
          onValueChange={(value) => onChange({ language: value })}
        >
          <Select.Trigger aria-label="识别语言" />
          <Select.Content>
            <Select.Item value="中文（普通话）">中文（普通话）</Select.Item>
            <Select.Item value="English">English</Select.Item>
            <Select.Item value="日本語">日本語</Select.Item>
            <Select.Item value="自动识别">自动识别</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      {listProblem && <p className={styles.presetProblem}>{listProblem}</p>}
      <p className={styles.hint}>
        录音时使用「当前使用」的那一台；切换后立刻生效，下一次录音就用新的模型。
      </p>
    </div>
  );
}
