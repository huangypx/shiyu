import type { CallRecord } from '@/types/models';

// 调用详情界面的格式化辅助函数。任何值都可能缺失，
// 因为服务商可以省略 usage 或耗时，所以这些函数返回
// 破折号，而不是会误导人的 0。

const tokenFormatter = new Intl.NumberFormat('en-US');

export function formatDuration(ms?: number) {
  if (ms === undefined || ms <= 0) return '—';
  if (ms < 1000) return Math.round(ms) + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(2) + 's';
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return minutes + 'm ' + seconds + 's';
}

export function formatTokens(count?: number) {
  return count && count > 0 ? tokenFormatter.format(count) : '—';
}

export function formatSeconds(seconds?: number) {
  return seconds && seconds > 0 ? seconds.toFixed(1) + 's' : '—';
}

export function formatBytes(bytes?: number) {
  if (!bytes || bytes <= 0) return '—';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

// 服务商相对实时的倍速，例如 "23.0x"。
export function formatRealtime(audioSeconds?: number, durationMs?: number) {
  if (!audioSeconds || !durationMs || durationMs <= 0) return '';
  const factor = (audioSeconds * 1000) / durationMs;
  return factor.toFixed(1) + 'x 实时';
}

export function callModeLabel(mode?: string) {
  if (mode === 'chat') return '对话接口';
  if (mode === 'transcriptions') return '转写接口';
  return '';
}

export function callKindLabel(kind: CallRecord['kind']) {
  return kind === 'asr' ? '语音识别' : '文字整理';
}

export function callKindShort(kind: CallRecord['kind']) {
  return kind === 'asr' ? '语音' : '整理';
}

export function formatClock(startedAt?: string) {
  if (!startedAt) return '—';
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(date);
}

export function callTokenText(call?: CallRecord) {
  if (!call) return '';
  const { inputTokens, outputTokens } = call.usage;
  if (!inputTokens && !outputTokens) return '';
  return (
    '入 ' +
    formatTokens(inputTokens) +
    ' / 出 ' +
    formatTokens(outputTokens) +
    ' tok'
  );
}

export type CallTotals = {
  total: number;
  failed: number;
  durationMs: number;
  tokens: number;
};

export function summarizeCalls(records: CallRecord[]): CallTotals {
  return records.reduce<CallTotals>(
    (totals, record) => ({
      total: totals.total + 1,
      failed: totals.failed + (record.ok ? 0 : 1),
      durationMs: totals.durationMs + (record.durationMs || 0),
      tokens: totals.tokens + (record.usage?.totalTokens || 0),
    }),
    { total: 0, failed: 0, durationMs: 0, tokens: 0 },
  );
}

// 美化输出原始 usage 对象；被截断或不是 JSON 的负载
// 原样显示，不抛异常。
export function formatUsageRaw(raw?: string) {
  if (!raw) return '';
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
