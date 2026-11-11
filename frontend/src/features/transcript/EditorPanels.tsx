import {
  Button,
  IconButton,
  Select,
  TextArea,
  Tooltip,
} from '@radix-ui/themes';
import {
  AlignLeft,
  Check,
  Copy,
  FileText,
  LoaderCircle,
  PenLine,
  Play,
  Trash2,
  Zap,
} from 'lucide-react';

import { CallSummary } from '@/features/calls/CallMetrics';
import type { CallMetrics, PolishPreset } from '@/types/models';

import styles from './EditorPanels.module.css';

type Props = {
  transcript: string;
  organized: string;
  isProcessing: boolean;
  copied: boolean;
  metrics?: CallMetrics;
  presets: PolishPreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
  onTranscriptChange: (value: string) => void;
  onClear: () => void;
  onOrganize: () => void;
  onCopy: () => void;
  onResetResult: () => void;
};

export default function EditorPanels({
  transcript,
  organized,
  isProcessing,
  copied,
  metrics,
  presets,
  activePresetId,
  onSelectPreset,
  onTranscriptChange,
  onClear,
  onOrganize,
  onCopy,
  onResetResult,
}: Props) {
  return (
    <div className={styles.grid}>
      <section className={styles.panel} aria-label="原始记录">
        <header className={styles.header}>
          <div className={styles.title}>
            <span className={styles.icon} aria-hidden="true">
              <PenLine size={14} />
            </span>
            <div className={styles.titleText}>
              <h2>原始记录</h2>
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
          </div>
        </header>
        <CallSummary label="语音识别" call={metrics?.asr} />
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
            <Zap size={13} />
            {transcript ? '内容会自动保存' : '试试说一段完整的话'}
          </span>
          <span className={styles.footerActions}>
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
      </section>

      <section className={styles.panel} aria-label="整理结果">
        <header className={styles.header}>
          <div className={styles.title}>
            <span className={styles.icon} aria-hidden="true">
              <AlignLeft size={14} />
            </span>
            <div className={styles.titleText}>
              <h2>整理结果</h2>
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
          </div>
        </header>
        <CallSummary label="文字整理" call={metrics?.llm} />
        <div className={styles.body}>
          {organized ? (
            <MarkdownPreview content={organized} />
          ) : (
            <EmptyResult onOrganize={onOrganize} />
          )}
        </div>
        <footer className={styles.footer}>
          <span className={styles.footerHint}>
            <Check size={13} />
            {organized ? '已根据你的偏好整理' : '录音后自动生成'}
          </span>
          <span className={styles.footerActions}>
            {presets.length > 0 && (
              // 选择预设只影响下一次整理；已有结果保留，方便对比。
              <Select.Root
                size="1"
                value={activePresetId}
                onValueChange={onSelectPreset}
                disabled={isProcessing}
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
            )}
            {organized && (
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={onResetResult}
              >
                重新整理
              </Button>
            )}
          </span>
        </footer>
      </section>
    </div>
  );
}

function EmptyResult({ onOrganize }: { onOrganize: () => void }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true">
        <FileText size={18} />
      </span>
      <strong>你的整理结果会出现在这里</strong>
      <p>拾语会提取重点、安排事项，让每句话都更有用。</p>
      <Button size="1" variant="soft" color="gray" onClick={onOrganize}>
        <Play size={12} fill="currentColor" /> 查看示例
      </Button>
    </div>
  );
}

// 只支持后端实际会返回的几种行：标题、列表、待办与
// 加粗元信息，不引入完整的 Markdown 解析器。
function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className={styles.markdown}>
      {content.split('\n').map((line, index) => {
        if (line.startsWith('## ')) return <h3 key={index}>{line.slice(3)}</h3>;
        if (line.startsWith('### '))
          return <h4 key={index}>{line.slice(4)}</h4>;
        if (line.startsWith('- [ ] '))
          return (
            <p className={styles.checkLine} key={index}>
              <span className={styles.checkBox} aria-hidden="true" />{' '}
              {line.slice(6)}
            </p>
          );
        if (line.startsWith('- '))
          return (
            <p className={styles.bulletLine} key={index}>
              <span aria-hidden="true">•</span> {line.slice(2)}
            </p>
          );
        if (/^\*\*(.+)\*\*/.test(line)) {
          const match = line.match(/^\*\*(.+?)\*\*　?(.*)$/);
          return (
            <p className={styles.metaLine} key={index}>
              <strong>{match?.[1]}</strong>
              {match?.[2]}
            </p>
          );
        }
        return line ? (
          <p key={index}>{line}</p>
        ) : (
          <div className={styles.lineSpace} key={index} />
        );
      })}
    </div>
  );
}
