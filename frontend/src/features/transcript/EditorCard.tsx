import { DropdownMenu } from '@radix-ui/themes';
import { Check, Copy, Ellipsis, Sparkles, Trash2 } from 'lucide-react';
import { useId } from 'react';

import type { PolishPreset } from '@/types/models';

import styles from './EditorCard.module.css';
import MarkdownPreview from './MarkdownPreview';

type Props = {
  transcript: string;
  organized: string;
  busy: boolean;
  copied: boolean;
  presets: PolishPreset[];
  activePresetId: string;
  onSelectPreset: (id: string) => void;
  onTranscriptChange: (value: string) => void;
  onClear: () => void;
  onOrganize: () => void;
  onCopy: () => void;
};

export default function EditorCard({
  transcript,
  organized,
  busy,
  copied,
  presets,
  activePresetId,
  onSelectPreset,
  onTranscriptChange,
  onClear,
  onOrganize,
  onCopy,
}: Props) {
  const sourceId = useId();
  const resultId = useId();
  const organizeLabel = organized ? '重新整理' : '整理文字';
  const copyLabel = copied ? '已复制' : '复制结果';
  return (
    <div className={styles.columns}>
      <section className={styles.source} aria-labelledby={sourceId}>
        <header className={styles.heading}>
          <h2 id={sourceId}>原文</h2>
          <div className={styles.sourceActions}>
            {transcript.trim() && (
              <button
                type="button"
                className={styles.action}
                aria-label={organizeLabel}
                title={organizeLabel}
                disabled={busy}
                onClick={onOrganize}
              >
                <Sparkles aria-hidden="true" />
              </button>
            )}
            <DropdownMenu.Root>
              <DropdownMenu.Trigger>
                <button
                  type="button"
                  className={styles.action}
                  aria-label="原文选项"
                  title="原文选项"
                >
                  <Ellipsis aria-hidden="true" />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Content size="2" align="end">
                {presets.length > 0 && (
                  <>
                    <DropdownMenu.Label>整理预设</DropdownMenu.Label>
                    <DropdownMenu.RadioGroup
                      value={activePresetId}
                      onValueChange={onSelectPreset}
                      aria-label="整理预设"
                    >
                      {presets.map((preset) => (
                        <DropdownMenu.RadioItem
                          key={preset.id}
                          value={preset.id}
                          disabled={busy}
                        >
                          {preset.name || '未命名预设'}
                        </DropdownMenu.RadioItem>
                      ))}
                    </DropdownMenu.RadioGroup>
                    <DropdownMenu.Separator />
                  </>
                )}
                <DropdownMenu.Item
                  color="red"
                  disabled={busy || (!transcript && !organized)}
                  onSelect={onClear}
                >
                  <Trash2 size={15} aria-hidden="true" /> 清空本次记录
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Root>
          </div>
        </header>
        <textarea
          className={styles.textarea}
          aria-labelledby={sourceId}
          value={transcript}
          readOnly={busy}
          onChange={(event) => onTranscriptChange(event.target.value)}
        />
      </section>
      <section className={styles.result} aria-labelledby={resultId}>
        <header className={styles.heading}>
          <h2 id={resultId}>整理结果</h2>
          <button
            type="button"
            className={styles.action}
            aria-label={copyLabel}
            title={copyLabel}
            disabled={!organized}
            onClick={onCopy}
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </button>
        </header>
        <div className={styles.resultBody}>
          {organized && <MarkdownPreview content={organized} />}
        </div>
      </section>
    </div>
  );
}
