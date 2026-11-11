import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { CallRecord } from '@/types/models';

import { CallDetails, CallSummary } from './CallMetrics';

const call: CallRecord = {
  id: 'llm-1',
  kind: 'llm',
  provider: 'openai-compatible',
  model: 'gpt-4o-mini',
  endpoint: 'https://example.test/v1/chat/completions',
  startedAt: new Date().toISOString(),
  durationMs: 640,
  usage: { inputTokens: 10, outputTokens: 6, totalTokens: 16 },
  ok: true,
};

describe('CallSummary', () => {
  it('显示这次整理使用的预设名称', () => {
    render(
      <Theme>
        <CallSummary label="文字整理" call={{ ...call, preset: '精简去重' }} />
      </Theme>,
    );

    expect(screen.getByText('精简去重')).toBeVisible();
  });

  it('没有预设字段时不多渲染 chip', () => {
    render(
      <Theme>
        <CallSummary label="文字整理" call={call} />
      </Theme>,
    );

    expect(screen.getByText('文字整理')).toBeVisible();
    expect(screen.queryByText('精简去重')).not.toBeInTheDocument();
  });

  it('详情里把预设与模型并列', () => {
    render(
      <Theme>
        <CallDetails call={{ ...call, preset: 'Markdown 结构' }} />
      </Theme>,
    );

    expect(screen.getByText('整理预设')).toBeVisible();
    expect(screen.getByText('Markdown 结构')).toBeVisible();
  });
});
