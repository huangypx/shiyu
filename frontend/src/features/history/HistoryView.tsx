import * as Collapsible from '@radix-ui/react-collapsible';
import { Button } from '@radix-ui/themes';
import {
  ArrowUpRight,
  Check,
  Clipboard,
  Copy,
  FileText,
  History,
  Play,
  Trash2,
} from 'lucide-react';
import { useState } from 'react';

import { CallSummary } from '@/features/calls/CallMetrics';
import { formatRelativeTime } from '@/lib/format';
import type { Note } from '@/types/models';

import styles from './HistoryView.module.css';

type Props = {
  notes: Note[];
  hasOlder: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  onOpen: (note: Note) => void;
  onCopy: (text: string) => Promise<void>;
  onPaste: (text: string) => Promise<void>;
  onDelete: (id: string) => void;
  onClear: () => void;
};

export default function HistoryView({
  notes,
  hasOlder,
  loadingOlder,
  onLoadOlder,
  onOpen,
  onCopy,
  onPaste,
  onDelete,
  onClear,
}: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // 清空是整个列表一起消失，必须先确认一次。
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <div className={styles.view}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            <History size={13} /> 你的记录
          </p>
          <h1>历史记录</h1>
          <p className={styles.subtitle}>
            每次生成的文字都可以重新查看和使用。
          </p>
        </div>
        <span className={styles.total}>
          {hasOlder ? '已显示 ' : ''}
          {notes.length} 条记录
        </span>
      </header>

      {notes.length || hasOlder ? (
        <>
          <div className={styles.toolbar}>
            {confirmClear ? (
              <>
                <span className={styles.confirm}>清空后无法恢复。</span>
                <Button
                  size="1"
                  variant="soft"
                  color="gray"
                  onClick={() => setConfirmClear(false)}
                >
                  取消
                </Button>
                <Button
                  size="1"
                  variant="solid"
                  color="red"
                  onClick={() => {
                    setConfirmClear(false);
                    onClear();
                  }}
                >
                  确认清空
                </Button>
              </>
            ) : (
              <Button
                size="1"
                variant="soft"
                color="gray"
                onClick={() => setConfirmClear(true)}
              >
                <Trash2 size={12} /> 清空历史
              </Button>
            )}
          </div>

          <div className={styles.list}>
            {notes.map((note) => {
              const expanded = expandedId === note.id;
              const result = note.organized || note.transcript || note.preview;
              return (
                <Collapsible.Root
                  key={note.id}
                  open={expanded}
                  onOpenChange={(open) => setExpandedId(open ? note.id : null)}
                >
                  <article className={styles.entry} data-open={expanded}>
                    <Collapsible.Trigger asChild>
                      <button type="button" className={styles.trigger}>
                        <span className={styles.fileIcon} aria-hidden="true">
                          <FileText size={15} />
                        </span>
                        <span className={styles.copy}>
                          <strong>{note.title}</strong>
                          <small>{note.preview}</small>
                        </span>
                        <span className={styles.time}>
                          {formatRelativeTime(note.createdAt)}
                        </span>
                        <ArrowUpRight size={15} aria-hidden="true" />
                      </button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <div className={styles.detail}>
                        <div className={styles.detailHeading}>
                          <span>
                            {note.organized ? '整理结果' : '转写原文'}
                          </span>
                          <span>{result.length} 字</span>
                        </div>
                        <div className={styles.detailBody}>{result}</div>
                        {note.transcript && note.transcript !== result && (
                          <details className={styles.transcript}>
                            <summary>转写原文</summary>
                            <div className={styles.detailBody}>
                              {note.transcript}
                            </div>
                          </details>
                        )}
                        {note.metrics && (
                          <div className={styles.metrics}>
                            <CallSummary
                              label="语音识别"
                              call={note.metrics.asr}
                            />
                            <CallSummary
                              label="文字整理"
                              call={note.metrics.llm}
                            />
                          </div>
                        )}
                        <div className={styles.detailActions}>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => {
                              void onCopy(result);
                              setCopiedId(note.id);
                              window.setTimeout(() => setCopiedId(null), 1400);
                            }}
                          >
                            {copiedId === note.id ? (
                              <Check size={13} />
                            ) : (
                              <Copy size={13} />
                            )}
                            {copiedId === note.id ? '已复制' : '复制结果'}
                          </Button>
                          <Button
                            size="1"
                            variant="soft"
                            color="gray"
                            onClick={() => void onPaste(result)}
                          >
                            <Play size={12} fill="currentColor" />{' '}
                            粘贴到当前光标
                          </Button>
                          <Button
                            size="1"
                            variant="ghost"
                            onClick={() => onOpen(note)}
                          >
                            <ArrowUpRight size={13} /> 打开到编辑器
                          </Button>
                          <Button
                            size="1"
                            variant="ghost"
                            color="red"
                            onClick={() => onDelete(note.id)}
                          >
                            <Trash2 size={12} /> 删除
                          </Button>
                        </div>
                      </div>
                    </Collapsible.Content>
                  </article>
                </Collapsible.Root>
              );
            })}
          </div>
        </>
      ) : (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true">
            <Clipboard size={18} />
          </span>
          <strong>还没有记录</strong>
          <p>按下“开始记录”，你的第一条想法会出现在这里。</p>
        </div>
      )}
      {hasOlder && (
        <Button
          className={styles.older}
          size="2"
          variant="soft"
          color="gray"
          disabled={loadingOlder}
          onClick={onLoadOlder}
        >
          {loadingOlder ? '正在加载…' : '查看更早的记录'}
        </Button>
      )}
    </div>
  );
}
