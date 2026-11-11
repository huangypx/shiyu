import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, TriangleAlert } from 'lucide-react';
import { useState } from 'react';

import type { CallRecord } from '@/types/models';

import {
  callModeLabel,
  callTokenText,
  formatBytes,
  formatClock,
  formatDuration,
  formatRealtime,
  formatSeconds,
  formatTokens,
  formatUsageRaw,
} from './callFormat';
import styles from './CallMetrics.module.css';

type SummaryProps = {
  // “语音识别”或“文字整理”——记录所属的面板。
  label: string;
  call?: CallRecord;
  error?: string;
};

// 服务商调用的一行摘要，显示在每个编辑器面板上方以及
// 历史详情里；展开后显示完整记录。
export function CallSummary({ label, call, error }: SummaryProps) {
  const [open, setOpen] = useState(false);
  if (!call) {
    return (
      <div className={styles.strip}>
        <span className={`${styles.chip} ${styles.kind}`}>{label}</span>
        <span className={styles.chip}>{error || '等待调用'}</span>
      </div>
    );
  }
  const failed = !call.ok;
  const mode = callModeLabel(call.mode);
  const realtime = formatRealtime(call.audioSeconds, call.durationMs);
  const tokens = callTokenText(call);
  const message = call.error || error;

  return (
    <Collapsible.Root
      open={open}
      onOpenChange={setOpen}
      className={styles.root}
    >
      <div className={styles.strip}>
        <span className={`${styles.chip} ${styles.kind}`}>{label}</span>
        {/* 预设名放在模型前面：同一次调用里，用户更关心用了哪套提示词。 */}
        {call.preset && <span className={styles.chip}>{call.preset}</span>}
        {mode && <span className={styles.chip}>{mode}</span>}
        {call.model && <span className={styles.chip}>{call.model}</span>}
        {Boolean(call.audioSeconds) && (
          <span className={styles.chip}>
            音频 {formatSeconds(call.audioSeconds)}
          </span>
        )}
        <span className={styles.chip}>{formatDuration(call.durationMs)}</span>
        {realtime && <span className={styles.chip}>{realtime}</span>}
        {tokens && <span className={styles.chip}>{tokens}</span>}
        {failed && (
          <span className={`${styles.chip} ${styles.failure}`}>
            <TriangleAlert size={11} /> 失败
            {call.statusCode ? ' · HTTP ' + call.statusCode : ''}
          </span>
        )}
        <Collapsible.Trigger asChild>
          <button type="button" className={styles.toggle} aria-expanded={open}>
            详情
            <ChevronDown size={12} className={open ? styles.flip : undefined} />
          </button>
        </Collapsible.Trigger>
      </div>
      {failed && message && <p className={styles.error}>{message}</p>}
      <Collapsible.Content>
        <CallDetails call={call} />
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

// 一次调用的完整记录：后端捕获的每个字段，外加原始
// usage 对象，非标准服务商也能调试。
export function CallDetails({ call }: { call: CallRecord }) {
  const rows: Array<[string, string]> = [['时间', formatClock(call.startedAt)]];
  if (call.preset) rows.push(['整理预设', call.preset]);
  if (call.model) rows.push(['模型', call.model]);
  rows.push(['接口', callModeLabel(call.mode) || call.endpoint]);
  rows.push([
    '状态',
    call.ok
      ? '成功'
      : '失败' + (call.statusCode ? ' · HTTP ' + call.statusCode : ''),
  ]);
  rows.push(['耗时', formatDuration(call.durationMs)]);
  if (call.serverMs) rows.push(['服务端耗时', formatDuration(call.serverMs)]);
  if (call.finishReason) rows.push(['结束原因', call.finishReason]);
  if (call.audioSeconds) {
    rows.push(['音频时长', formatSeconds(call.audioSeconds)]);
    const realtime = formatRealtime(call.audioSeconds, call.durationMs);
    if (realtime) rows.push(['实时倍率', realtime]);
  }
  const usage = call.usage;
  if (usage.totalTokens) {
    rows.push([
      'tokens',
      '入 ' +
        formatTokens(usage.inputTokens) +
        ' / 出 ' +
        formatTokens(usage.outputTokens) +
        ' / 合计 ' +
        formatTokens(usage.totalTokens),
    ]);
  }
  if (usage.audioTokens)
    rows.push(['音频 tokens', formatTokens(usage.audioTokens)]);
  if (usage.cachedTokens)
    rows.push(['命中缓存', formatTokens(usage.cachedTokens)]);
  if (usage.reasoningTokens) {
    rows.push(['思考 tokens', formatTokens(usage.reasoningTokens)]);
  }
  if (call.requestBytes)
    rows.push(['请求大小', formatBytes(call.requestBytes)]);
  if (call.responseBytes)
    rows.push(['响应大小', formatBytes(call.responseBytes)]);
  if (call.requestId) rows.push(['request id', call.requestId]);
  if (call.responseId) rows.push(['response id', call.responseId]);
  const raw = formatUsageRaw(usage.raw);

  return (
    <div className={styles.details}>
      <dl className={styles.grid}>
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {raw && (
        <>
          <p className={styles.rawLabel}>原始 usage</p>
          <pre className={styles.raw}>{raw}</pre>
        </>
      )}
      {call.error && <p className={styles.error}>{call.error}</p>}
    </div>
  );
}
