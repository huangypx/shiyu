import { describe, expect, it } from 'vitest';

import { formatShortcut } from './shortcut';

describe('formatShortcut', () => {
  it('macOS 显示命令键', () => {
    expect(formatShortcut('darwin', 'N')).toBe('⌘N');
    expect(formatShortcut('darwin', '\\')).toBe('⌘\\');
  });

  it('Windows 与 Linux 显示 Ctrl', () => {
    expect(formatShortcut('windows', 'N')).toBe('Ctrl+N');
    expect(formatShortcut('linux', '\\')).toBe('Ctrl+\\');
  });

  it('网页预览按非 macOS 处理', () => {
    expect(formatShortcut('web', ',')).toBe('Ctrl+,');
  });
});
