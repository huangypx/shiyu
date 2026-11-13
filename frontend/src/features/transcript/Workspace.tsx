import { Button, Select, TextArea } from '@radix-ui/themes';
import { AlignLeft, Check, Copy } from 'lucide-react';
import { type CSSProperties, useId, useRef, useState } from 'react';

import RecorderControls from '@/features/recorder/RecorderControls';
import type {
  CopyTarget,
  SessionStage,
  SessionStatus,
} from '@/store/sessionStore';
import {
  type AsrModelConfig,
  type LlmModelConfig,
  type PolishPreset,
  RECOGNITION_LANGUAGES,
  shortLanguage,
} from '@/types/models';

import styles from './Workspace.module.css';

type Props = {
  status: SessionStatus;
  stage: SessionStage;
  transcript: string;
  organized: string;
  // 哪一栏刚复制过：只让那一栏的按钮变成「已复制」。
  copied: CopyTarget;
  presets: PolishPreset[];
  activePresetId: string;
  // 栏头显示的模型就是这次录音/整理实际会用到的那两台，
  // 由 useRecordingSession 用 types/models 的 helper 解析。
  asrModel: AsrModelConfig;
  llmModel: LlmModelConfig;
  // 下拉框要列出配置里的全部模型，用户才能在栏头直接换一台。
  asrModels: AsrModelConfig[];
  llmModels: LlmModelConfig[];
  language: string;
  // 两栏宽度比例（0.28–0.72）由页面持有，拖动分隔线时回传新值。
  split: number;
  onSplitChange: (split: number) => void;
  onToggleRecording: () => void;
  onTranscriptChange: (value: string) => void;
  // 整理结果同样可编辑：结果落地后直接改字，比重新整理更快。
  onOrganizedChange: (value: string) => void;
  onOrganize: () => void;
  onCopyTranscript: () => void;
  onCopyResult: () => void;
  onSelectPreset: (id: string) => void;
  onSelectAsrModel: (id: string) => void;
  onSelectLlmModel: (id: string) => void;
  onSelectLanguage: (language: string) => void;
};

// 两栏标题是产品负责人确认的命名：左栏「识别结果」放语音识别原文，
// 右栏「转写内容」放整理后的最终文字。标题和数据来源看起来是反的，
// 但这是刻意的命名，不要按字面「纠正」成原文与整理结果。
export default function Workspace({
  status,
  stage,
  transcript,
  organized,
  copied,
  presets,
  activePresetId,
  asrModel,
  llmModel,
  asrModels,
  llmModels,
  language,
  split,
  onSplitChange,
  onToggleRecording,
  onTranscriptChange,
  onOrganizedChange,
  onOrganize,
  onCopyTranscript,
  onCopyResult,
  onSelectPreset,
  onSelectAsrModel,
  onSelectLlmModel,
  onSelectLanguage,
}: Props) {
  // 标题既给 section 命名，也给下面的文本域命名，两处共用同一个 id。
  const sourceTitleId = useId();
  const resultTitleId = useId();
  const workspaceRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  // 比例按工作区总宽算，再夹到 28%–72%：这是两栏各自放得下栏头控件的下限。
  const applySplit = (ratio: number) => {
    onSplitChange(Math.min(0.72, Math.max(0.28, ratio)));
  };
  const splitFromPointer = (clientX: number) => {
    const rect = workspaceRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    applySplit((clientX - rect.left) / rect.width);
  };
  const isArming = status === 'arming';
  const isRecording = status === 'recording';
  const isProcessing = status === 'processing';
  const isOrganizing = isProcessing && stage === 'organize';
  // 流式返回时后端会覆盖写入文本，此时编辑只会被下一次增量冲掉。
  // 两栏自动跟着状态只读/可编辑，不需要用户手动切换。
  const streaming = isProcessing;

  return (
    <div
      className={styles.workspace}
      ref={workspaceRef}
      style={{ '--split-left': `${split * 100}%` } as CSSProperties}
    >
      <section className={styles.column} aria-labelledby={sourceTitleId}>
        <header className={styles.head}>
          <h2 className={styles.title} id={sourceTitleId}>
            识别结果
          </h2>
          <div className={styles.headActions}>
            <ModelSelect
              models={asrModels}
              value={asrModel.id}
              onChange={onSelectAsrModel}
              label="语音识别模型"
            />
            <LanguageSelect language={language} onChange={onSelectLanguage} />
            <RecorderControls
              isArming={isArming}
              isRecording={isRecording}
              isProcessing={isProcessing}
              stage={stage}
              onToggle={onToggleRecording}
            />
          </div>
        </header>
        <div className={styles.body}>
          <TextArea
            className={styles.textarea}
            value={transcript}
            readOnly={streaming}
            onChange={(event) => onTranscriptChange(event.target.value)}
            placeholder="点击录音，或直接输入文字"
            aria-labelledby={sourceTitleId}
          />
        </div>
        <footer className={styles.foot}>
          <span className={styles.count}>{transcript.length} 字</span>
          <div className={styles.footActions}>
            <Button
              size="1"
              variant="soft"
              color="gray"
              aria-label={copied === 'asr' ? '已复制识别结果' : '复制识别结果'}
              disabled={!transcript.trim()}
              onClick={onCopyTranscript}
            >
              {copied === 'asr' ? <Check size={13} /> : <Copy size={13} />}
              {copied === 'asr' ? '已复制' : '复制'}
            </Button>
            <Button
              size="1"
              color="gray"
              highContrast
              disabled={!transcript.trim() || isProcessing}
              onClick={onOrganize}
            >
              <AlignLeft size={13} /> 整理文字
            </Button>
          </div>
        </footer>
      </section>

      <section
        className={`${styles.column} ${styles.result}`}
        aria-labelledby={resultTitleId}
      >
        <header className={styles.head}>
          <h2 className={styles.title} id={resultTitleId}>
            转写内容
          </h2>
          <div className={styles.headActions}>
            <ModelSelect
              models={llmModels}
              value={llmModel.id}
              onChange={onSelectLlmModel}
              label="整理模型"
            />
            <PresetSelect
              presets={presets}
              activePresetId={activePresetId}
              onSelectPreset={onSelectPreset}
              disabled={isProcessing}
            />
          </div>
        </header>
        <div className={styles.resultBody}>
          {/* 右栏和左栏一样是一块可以写的纸：不设「编辑」开关，
              LLM 输出期间只读，输出完成后自动恢复可编辑。
              重新整理时保留旧内容，直到新结果覆盖它。 */}
          <TextArea
            className={styles.textarea}
            value={organized}
            readOnly={streaming}
            onChange={(event) => onOrganizedChange(event.target.value)}
            placeholder={
              isOrganizing ? '正在整理，输出完成后可以编辑' : '还没有内容'
            }
            aria-labelledby={resultTitleId}
          />
        </div>
        {/* 栏脚始终占位：左栏的字数与按钮已经把它画出来了，
            右栏空着不画，两栏底部那条横线就会错层。 */}
        <footer className={styles.foot}>
          <span className={styles.count}>{organized.length} 字</span>
          {organized && (
            <div className={styles.footActions}>
              <Button
                size="1"
                variant="soft"
                color="gray"
                aria-label={
                  copied === 'llm' ? '已复制转写内容' : '复制转写内容'
                }
                disabled={streaming}
                onClick={onCopyResult}
              >
                {copied === 'llm' ? <Check size={13} /> : <Copy size={13} />}
                {copied === 'llm' ? '已复制' : '复制'}
              </Button>
              <Button
                size="1"
                color="gray"
                highContrast
                disabled={isProcessing}
                onClick={onOrganize}
              >
                重新整理
              </Button>
            </div>
          )}
        </footer>
      </section>

      {/* 分隔线同时是拖动区：1px 的线放在 11px 的命中区中间，
          鼠标不用像素级瞄准；方向键与双击也按同一套比例走。
          用 button 而不是可聚焦的 separator：它真的可以被拖动和按键操作，
          当前比例写在可访问名称里，读屏才不会只念出一个静态分隔符。 */}
      <button
        type="button"
        className={styles.splitter}
        data-dragging={dragging ? 'true' : 'false'}
        aria-label={`调整两栏宽度，当前左栏 ${Math.round(split * 100)}%`}
        title="拖动调整两栏宽度，双击恢复居中"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          splitFromPointer(event.clientX);
        }}
        onPointerUp={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          event.currentTarget.releasePointerCapture(event.pointerId);
          setDragging(false);
        }}
        onPointerCancel={() => setDragging(false)}
        onDoubleClick={() => applySplit(0.5)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            applySplit(split - 0.02);
          } else if (event.key === 'ArrowRight') {
            event.preventDefault();
            applySplit(split + 0.02);
          } else if (event.key === 'Home') {
            event.preventDefault();
            applySplit(0.5);
          }
        }}
      />
    </div>
  );
}

type ModelOption = Pick<
  AsrModelConfig | LlmModelConfig,
  'id' | 'name' | 'model' | 'provider' | 'baseUrl'
>;

// 栏头的模型下拉框：触发框只写 model 字段，菜单里才用「名称 · 模型」
// 把两台同名端点区分开；完整配置（名称、服务商、地址）挂在 title 上。
function ModelSelect({
  models,
  value,
  onChange,
  label,
}: {
  models: ModelOption[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const current = models.find((model) => model.id === value) ?? models[0];
  return (
    <Select.Root size="1" value={value} onValueChange={onChange}>
      <Select.Trigger
        variant="soft"
        aria-label={label}
        className={`${styles.headSelect} ${styles.modelSelect}`}
        title={
          current
            ? `${current.name} · ${current.provider} · ${current.baseUrl}`
            : undefined
        }
      >
        <span className={styles.selectText}>
          {current?.model || current?.name || '未命名模型'}
        </span>
      </Select.Trigger>
      <Select.Content position="popper">
        {models.map((model) => (
          <Select.Item key={model.id} value={model.id}>
            {modelOptionLabel(model)}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function modelOptionLabel(model: ModelOption) {
  const name = model.name || model.model || '未命名模型';
  return model.model && model.model !== name
    ? `${name} · ${model.model}`
    : name;
}

// 识别语言同样是下拉框：选项与设置页共用 RECOGNITION_LANGUAGES，
// 配置里遗留的自定义语言不在表里，也补进菜单，免得触发框显示不出来。
function LanguageSelect({
  language,
  onChange,
}: {
  language: string;
  onChange: (language: string) => void;
}) {
  const options: string[] = (
    RECOGNITION_LANGUAGES as readonly string[]
  ).includes(language)
    ? [...RECOGNITION_LANGUAGES]
    : [language, ...RECOGNITION_LANGUAGES];
  return (
    <Select.Root size="1" value={language} onValueChange={onChange}>
      <Select.Trigger
        variant="soft"
        aria-label="识别语言"
        className={styles.headSelect}
        title={language}
      >
        <span className={styles.selectText}>{shortLanguage(language)}</span>
      </Select.Trigger>
      <Select.Content position="popper">
        {options.map((option) => (
          <Select.Item key={option} value={option}>
            {option}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

function PresetSelect({
  presets,
  activePresetId,
  onSelectPreset,
  disabled,
}: {
  presets: PolishPreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
  disabled: boolean;
}) {
  if (presets.length === 0) return null;
  return (
    // 选择预设只影响下一次整理；已有结果保留，方便对比。
    <Select.Root
      size="1"
      value={activePresetId}
      onValueChange={onSelectPreset}
      disabled={disabled}
    >
      <Select.Trigger
        variant="soft"
        aria-label="整理预设"
        title="选择整理时使用的提示词预设"
      />
      <Select.Content position="popper">
        {presets.map((preset) => (
          <Select.Item key={preset.id} value={preset.id}>
            {preset.name || '未命名预设'}
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}
