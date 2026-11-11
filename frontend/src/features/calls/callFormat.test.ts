import { describe, expect, it } from 'vitest';

import type { CallRecord } from '@/types/models';

import {
  formatBytes,
  formatClock,
  formatDuration,
  formatRealtime,
  formatTokens,
  formatUsageRaw,
  summarizeCalls,
} from './callFormat';

const baseCall: CallRecord = {
  id: 'a',
  kind: 'asr',
  provider: 'openai',
  model: 'whisper-1',
  endpoint: 'https://example.com/v1/audio/transcriptions',
  startedAt: '2026-11-09T12:00:00.000Z',
  durationMs: 1200,
  usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
  ok: true,
};

describe('callFormat', () => {
  it('缺失值用破折号，而不是误导人的 0', () => {
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(0)).toBe('—');
    expect(formatTokens(0)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
  });

  it('按量级切换耗时单位', () => {
    expect(formatDuration(320)).toBe('320ms');
    expect(formatDuration(1200)).toBe('1.20s');
    expect(formatDuration(65_000)).toBe('1m 5s');
  });

  it('实时倍率只在音频时长与耗时都有值时计算', () => {
    expect(formatRealtime(12.4, 540)).toBe('23.0x 实时');
    expect(formatRealtime(undefined, 540)).toBe('');
  });

  it('时钟格式对非法时间保持安全', () => {
    expect(formatClock(undefined)).toBe('—');
    expect(formatClock('not-a-date')).toBe('—');
  });

  it('汇总只统计总数、失败数、耗时与 token', () => {
    const failed: CallRecord = {
      ...baseCall,
      id: 'b',
      ok: false,
      durationMs: 800,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    };
    expect(summarizeCalls([baseCall, failed])).toEqual({
      total: 2,
      failed: 1,
      durationMs: 2000,
      tokens: 14,
    });
  });

  it('非 JSON 的原始 usage 原样返回', () => {
    expect(formatUsageRaw('not json')).toBe('not json');
    expect(formatUsageRaw('{"a":1}')).toBe('{\n  "a": 1\n}');
  });
});
