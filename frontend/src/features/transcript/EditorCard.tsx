import {
  Button,
  IconButton,
  Select,
  TextArea,
  Tooltip,
} from '@radix-ui/themes';
import {
  AlignLeft,
  ArrowLeftRight,
  Check,
  Copy,
  FileText,
  LoaderCircle,
  PenLine,
  Trash2,
  Zap,
} from 'lucide-react';
import { domAnimation, LazyMotion, m } from 'motion/react';
import { type RefObject, useEffect, useRef, useState } from 'react';

import { CallSummary } from '@/features/calls/CallMetrics';
import { useMediaQuery } from '@/lib/useMediaQuery';
import type { SessionStatus } from '@/store/sessionStore';
import type { CallMetrics, PolishPreset } from '@/types/models';

import styles from './EditorCard.module.css';
import MarkdownPreview from './MarkdownPreview';

type Face = 'source' | 'result';

type PresetPicker = {
  presets: PolishPreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
};

type Props = {
  status: SessionStatus;
  transcript: string;
  organized: string;
  isProcessing: boolean;
  // 处理中的两段要分开说明：只有整理阶段才会自动翻面。
  isOrganizing: boolean;
  copied: boolean;
  metrics: CallMetrics;
  presets: PolishPreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
  onTranscriptChange: (value: string) => void;
  onClear: () => void;
  onOrganize: () => void;
  onCopy: () => void;
};

// 一张卡的两个面。两面背对背叠在一起，整张卡一次转 180°：
// 转到一半时正面转开、背面转过来，内容才算「翻过去了」。
// 不用 AnimatePresence 换面，是因为先卸载再挂载会让内容在
// 翻到 90° 之前就被换掉，看起来只翻了半程。
export default function EditorCard({
  status,
  transcript,
  organized,
  isProcessing,
  isOrganizing,
  copied,
  metrics,
  presets,
  activePresetId,
  onSelectPreset,
  onTranscriptChange,
  onClear,
  onOrganize,
  onCopy,
}: Props) {
  const [manualFace, setManualFace] = useState<Face | null>(null);
  const [lastInput, setLastInput] = useState({ organized, status });
  // 系统开了「减少动态效果」就不转，改成两面淡入淡出。
  // 用本仓库的 useMediaQuery 而不是动效库的同名 hook：它在首帧
  // 就给出真实值，不会让卡片先转到 180° 再被降级方案扳回来。
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const cardRef = useRef<HTMLDivElement>(null);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  // 翻面会把上一面的控件变成 inert，焦点要交给新一面的标题；
  // 用聚焦事件记录「用户正在卡里」，避免在渲染期读 DOM。
  const focusWithin = useRef(false);

  // 数据一变，手动翻面的方向立刻作废。在渲染期对比而不是放进
  // effect：那样会先渲染旧面再马上翻回来，动画会闪一下。
  if (lastInput.organized !== organized || lastInput.status !== status) {
    const organizedChanged = lastInput.organized !== organized;
    setLastInput({ organized, status });
    // 结果变化，或新一次录音开始（接下来写进去的是转写文字），
    // 视图都要回到数据指定的那一面。
    if (organizedChanged || status === 'arming' || status === 'recording') {
      setManualFace(null);
    }
  }

  // 有整理结果就落在反面，没有就留在正面；manualFace 只是
  // 用户手动翻面留下的临时覆盖，数据一变就让位给数据。
  const face: Face = manualFace ?? (organized ? 'result' : 'source');
  const showResult = face === 'result';

  // 只看 focusin：翻面把手上的控件变成 inert 时浏览器会把焦点丢回
  // body，那一刻的 blur 不能当作「用户已经离开卡片」。
  useEffect(() => {
    const track = (event: FocusEvent) => {
      focusWithin.current =
        cardRef.current?.contains(event.target as Node | null) ?? false;
    };
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);

  useEffect(() => {
    if (!focusWithin.current) return;
    const heading = showResult ? resultHeading : sourceHeading;
    heading.current?.focus();
  }, [showResult]);

  return (
    <div className={styles.viewport} ref={cardRef}>
      <LazyMotion features={domAnimation} strict>
        <m.div
          className={styles.flipper}
          initial={false}
          // 减少动态效果时整张卡不转，两面靠透明度切换。
          animate={{ rotateY: reduceMotion ? 0 : showResult ? 180 : 0 }}
          transition={
            reduceMotion
              ? { duration: 0 }
              : { duration: 0.55, ease: 'easeInOut' }
          }
        >
          <m.section
            className={styles.face}
            data-face="source"
            aria-label="原始记录"
            // 背面留在 DOM 里（翻面时才看得到），但不能进可访问性树
            // 和 Tab 序列，否则读屏会念到另一面的内容。
            aria-hidden={showResult || undefined}
            {...(showResult ? { inert: '' } : {})}
            animate={reduceMotion ? { opacity: showResult ? 0 : 1 } : undefined}
            transition={{ duration: 0.18 }}
          >
            <SourceFace
              transcript={transcript}
              metrics={metrics}
              isProcessing={isProcessing}
              isOrganizing={isOrganizing}
              headingRef={sourceHeading}
              presets={presets}
              activePresetId={activePresetId}
              onSelectPreset={onSelectPreset}
              onTranscriptChange={onTranscriptChange}
              onClear={onClear}
              onOrganize={onOrganize}
              onFlip={() => setManualFace('result')}
            />
          </m.section>
          <m.section
            className={`${styles.face} ${styles.faceBack}${reduceMotion ? ' ' + styles.faceFlat : ''}`}
            data-face="result"
            aria-label="整理结果"
            aria-hidden={!showResult || undefined}
            {...(showResult ? {} : { inert: '' })}
            animate={reduceMotion ? { opacity: showResult ? 1 : 0 } : undefined}
            transition={{ duration: 0.18 }}
          >
            <ResultFace
              organized={organized}
              hasTranscript={Boolean(transcript.trim())}
              metrics={metrics}
              copied={copied}
              isProcessing={isProcessing}
              isOrganizing={isOrganizing}
              headingRef={resultHeading}
              presets={presets}
              activePresetId={activePresetId}
              onSelectPreset={onSelectPreset}
              onOrganize={onOrganize}
              onCopy={onCopy}
              onFlip={() => setManualFace('source')}
            />
          </m.section>
        </m.div>
      </LazyMotion>
    </div>
  );
}

type SourceFaceProps = {
  transcript: string;
  metrics: CallMetrics;
  isProcessing: boolean;
  isOrganizing: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onTranscriptChange: (value: string) => void;
  onClear: () => void;
  onOrganize: () => void;
  onFlip: () => void;
} & PresetPicker;

function SourceFace({
  transcript,
  metrics,
  isProcessing,
  isOrganizing,
  headingRef,
  presets,
  activePresetId,
  onSelectPreset,
  onTranscriptChange,
  onClear,
  onOrganize,
  onFlip,
}: SourceFaceProps) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.icon} aria-hidden="true">
            <PenLine size={14} />
          </span>
          <div className={styles.titleText}>
            <h2 ref={headingRef} tabIndex={-1}>
              原始记录
            </h2>
            <span>可以直接编辑转写内容</span>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={styles.count}>{transcript.length} 字</span>
          <Tooltip content="清空">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label="清空"
              onClick={onClear}
            >
              <Trash2 size={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content="翻到整理结果">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label="翻到整理结果"
              onClick={onFlip}
            >
              <ArrowLeftRight size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </header>
      <CallSummary label="语音识别" call={metrics.asr} />
      <div className={styles.body}>
        <TextArea
          className={styles.textarea}
          variant="soft"
          value={transcript}
          onChange={(event) => onTranscriptChange(event.target.value)}
          placeholder="录音结束后，文字会显示在这里…&#10;&#10;你也可以直接输入或粘贴文字。"
          aria-label="原始转写"
        />
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerHint}>
          {isProcessing ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Zap size={13} />
          )}
          {isOrganizing
            ? '正在整理，完成后自动翻到结果'
            : isProcessing
              ? '正在识别语音…'
              : transcript
                ? '内容会自动保存'
                : '试试说一段完整的话'}
        </span>
        <span className={styles.footerActions}>
          <PresetSelect
            presets={presets}
            activePresetId={activePresetId}
            onSelectPreset={onSelectPreset}
            disabled={isProcessing}
          />
          <Button
            size="2"
            color="gray"
            highContrast
            disabled={!transcript.trim() || isProcessing}
            onClick={onOrganize}
          >
            {isProcessing ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <AlignLeft size={14} />
            )}
            整理文字
          </Button>
        </span>
      </footer>
    </>
  );
}

type ResultFaceProps = {
  organized: string;
  hasTranscript: boolean;
  metrics: CallMetrics;
  copied: boolean;
  isProcessing: boolean;
  isOrganizing: boolean;
  headingRef: RefObject<HTMLHeadingElement>;
  onOrganize: () => void;
  onCopy: () => void;
  onFlip: () => void;
} & PresetPicker;

function ResultFace({
  organized,
  hasTranscript,
  metrics,
  copied,
  isProcessing,
  isOrganizing,
  headingRef,
  presets,
  activePresetId,
  onSelectPreset,
  onOrganize,
  onCopy,
  onFlip,
}: ResultFaceProps) {
  return (
    <>
      <header className={styles.header}>
        <div className={styles.title}>
          <span className={styles.icon} aria-hidden="true">
            <AlignLeft size={14} />
          </span>
          <div className={styles.titleText}>
            <h2 ref={headingRef} tabIndex={-1}>
              整理结果
            </h2>
            <span>更清晰，也更接近你的本意</span>
          </div>
        </div>
        <div className={styles.actions}>
          <Tooltip content={copied ? '已复制' : '复制结果'}>
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              disabled={!organized}
              aria-label="复制结果"
              onClick={onCopy}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
            </IconButton>
          </Tooltip>
          <Tooltip content="翻回原始记录">
            <IconButton
              variant="ghost"
              color="gray"
              size="1"
              aria-label="翻回原始记录"
              onClick={onFlip}
            >
              <ArrowLeftRight size={14} />
            </IconButton>
          </Tooltip>
        </div>
      </header>
      <CallSummary label="文字整理" call={metrics.llm} />
      <div className={styles.body}>
        {organized ? (
          <MarkdownPreview content={organized} />
        ) : isOrganizing ? (
          <div className={styles.empty} aria-live="polite">
            <span className={styles.emptyIcon} aria-hidden="true">
              <LoaderCircle className="spin" size={18} />
            </span>
            <strong>正在整理你的文字</strong>
            <p>整理完成后会直接翻到这里。</p>
          </div>
        ) : (
          <EmptyResult
            hasTranscript={hasTranscript}
            isProcessing={isProcessing}
            onOrganize={onOrganize}
          />
        )}
      </div>
      <footer className={styles.footer}>
        <span className={styles.footerHint}>
          {isOrganizing ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Check size={13} />
          )}
          {isOrganizing
            ? '正在整理…'
            : organized
              ? '已根据你的偏好整理'
              : '录音后自动生成'}
        </span>
        <span className={styles.footerActions}>
          <PresetSelect
            presets={presets}
            activePresetId={activePresetId}
            onSelectPreset={onSelectPreset}
            disabled={isProcessing}
          />
          {organized && (
            <Button
              size="1"
              variant="soft"
              color="gray"
              disabled={isProcessing}
              onClick={onOrganize}
            >
              {isOrganizing ? (
                <LoaderCircle className="spin" size={12} />
              ) : null}
              重新整理
            </Button>
          )}
        </span>
      </footer>
    </>
  );
}

function EmptyResult({
  hasTranscript,
  isProcessing,
  onOrganize,
}: {
  hasTranscript: boolean;
  isProcessing: boolean;
  onOrganize: () => void;
}) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <FileText size={18} />
      </span>
      <strong>你的整理结果会出现在这里</strong>
      <p>拾语会提取重点、安排事项，让每句话都更有用。</p>
      <Button
        size="1"
        variant="soft"
        color="gray"
        disabled={!hasTranscript || isProcessing}
        onClick={onOrganize}
      >
        <AlignLeft size={12} /> 整理文字
      </Button>
    </div>
  );
}

function PresetSelect({
  presets,
  activePresetId,
  onSelectPreset,
  disabled,
}: PresetPicker & { disabled: boolean }) {
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
