import * as Collapsible from '@radix-ui/react-collapsible';
import { Button } from '@radix-ui/themes';
import {
  Activity,
  Check,
  Clipboard,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useState } from 'react';

import type { CallRecord } from '@/types/models';

import {
  callKindShort,
  callTokenText,
  formatClock,
  formatDuration,
  formatTokens,
  summarizeCalls,
} from './callFormat';
import { CallDetails } from './CallMetrics';
import styles from './CallsView.module.css';

type Props = {
  calls: CallRecord[];
  onClear: () => void;
};

// 本次会话的每次服务商调用，最新的在前。失败的调用也会
// 列出，卡住或被拒绝的请求因此可以诊断。
export default function CallsView({ calls, onClear }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const totals = summarizeCalls(calls);

  return (
    <div className={styles.view}>
      <header className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>
            <Activity size={13} /> 调用详情
          </p>
          <h1>调用记录</h1>
          <p className={styles.subtitle}>
            每一次语音识别和文字整理的耗时与 token 用量。
          </p>
        </div>
        <span className={styles.total}>{calls.length} 次调用</span>
      </header>

      {calls.length ? (
        <>
          <div className={styles.summary}>
            <span className={styles.chip}>
              成功 {totals.total - totals.failed}
            </span>
            <span
              className={
                totals.failed
                  ? `${styles.chip} ${styles.chipError}`
                  : styles.chip
              }
            >
              失败 {totals.failed}
            </span>
            <span className={styles.chip}>
              总耗时 {formatDuration(totals.durationMs)}
            </span>
            <span className={styles.chip}>
              总 tokens {formatTokens(totals.tokens)}
            </span>
            <Button
              className={styles.clear}
              size="1"
              variant="soft"
              color="red"
              onClick={onClear}
            >
              <Trash2 size={12} /> 清空
            </Button>
          </div>

          <div className={styles.list}>
            {calls.map((call) => {
              const expanded = expandedId === call.id;
              return (
                <Collapsible.Root
                  key={call.id}
                  open={expanded}
                  onOpenChange={(open) => setExpandedId(open ? call.id : null)}
                >
                  <article className={styles.entry} data-open={expanded}>
                    <Collapsible.Trigger asChild>
                      <button type="button" className={styles.trigger}>
                        <span
                          className={
                            call.ok
                              ? styles.badge
                              : `${styles.badge} ${styles.badgeError}`
                          }
                        >
                          {callKindShort(call.kind)}
                        </span>
                        <span className={styles.copy}>
                          <strong>
                            {call.model || call.provider || '未命名模型'}
                          </strong>
                          <small>
                            {/* 整理调用在列表里就带上预设名，否则要展开才知道用了哪套提示词。 */}
                            {call.preset ? call.preset + ' · ' : ''}
                            {call.ok ? '成功' : '失败'} · 耗时{' '}
                            {formatDuration(call.durationMs)}
                            {callTokenText(call)
                              ? ' · ' + callTokenText(call)
                              : ''}
                            {!call.ok && call.error ? ' · ' + call.error : ''}
                          </small>
                        </span>
                        <span
                          className={
                            call.ok
                              ? styles.status
                              : `${styles.status} ${styles.statusError}`
                          }
                          aria-label={call.ok ? '成功' : '失败'}
                        >
                          {call.ok ? (
                            <Check size={14} />
                          ) : (
                            <TriangleAlert size={14} />
                          )}
                        </span>
                        <span className={styles.time}>
                          {formatClock(call.startedAt)}
                        </span>
                      </button>
                    </Collapsible.Trigger>
                    <Collapsible.Content>
                      <div className={styles.detail}>
                        <CallDetails call={call} />
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
          <strong>还没有调用</strong>
          <p>录一次音，语音识别和文字整理的明细会出现在这里。</p>
        </div>
      )}
    </div>
  );
}
