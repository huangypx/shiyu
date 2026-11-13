import {
  type CallMetrics,
  type CallRecord,
  DEFAULT_ASR_MODEL,
} from '@/types/models';

// 浏览器预览没有 Wails 绑定，也就没有任何服务商调用；
// 演示数据让调用记录、编辑器面板在预览里仍然可读。

export const MOCK_TRANSCRIPT =
  '下午三点和设计团队开会，讨论首页改版。会后把会议纪要发给小林，并在明天上午提醒我跟进。';

export const MOCK_ORGANIZED = `## 首页改版讨论

**时间**　今天 15:00
**参与者**　设计团队

### 讨论重点
- 讨论首页的视觉与交互改版

### 待办事项
- [ ] 会后将会议纪要发送给小林
- [ ] 明天上午跟进首页改版进度`;

const demoStartedAt = new Date().toISOString();

export const MOCK_CALLS: CallRecord[] = [
  {
    id: 'demo-llm',
    kind: 'llm',
    provider: 'openai-compatible',
    model: 'gpt-4o-mini',
    // 演示数据也带上预设名，调用记录页才能在浏览器预览里展示新字段。
    preset: '会议纪要',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    startedAt: demoStartedAt,
    durationMs: 4720,
    serverMs: 4601,
    statusCode: 200,
    responseId: 'chatcmpl-demo',
    requestBytes: 512,
    responseBytes: 980,
    usage: { inputTokens: 512, outputTokens: 380, totalTokens: 892 },
    ok: true,
  },
  {
    id: 'demo-asr',
    kind: 'asr',
    provider: 'openai-compatible',
    model: DEFAULT_ASR_MODEL.model,
    mode: 'transcriptions',
    endpoint: 'https://api.openai.com/v1/audio/transcriptions',
    startedAt: demoStartedAt,
    durationMs: 540,
    statusCode: 200,
    requestBytes: 32044,
    responseBytes: 220,
    audioSeconds: 12.4,
    usage: {
      inputTokens: 1204,
      outputTokens: 12,
      totalTokens: 1216,
      audioTokens: 1180,
    },
    ok: true,
  },
];

export const MOCK_METRICS: CallMetrics = {
  asr: MOCK_CALLS[1],
  llm: MOCK_CALLS[0],
};
