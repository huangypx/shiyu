import { describe, expect, it } from 'vitest';

import { matchesHotkey } from './hotkey';

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init);
}

describe('matchesHotkey', () => {
  it('识别默认的 Ctrl+Shift+Space', () => {
    expect(
      matchesHotkey(
        keyEvent({ key: ' ', code: 'Space', ctrlKey: true, shiftKey: true }),
        'Ctrl+Shift+Space',
      ),
    ).toBe(true);
  });

  it('缺少修饰键时不触发', () => {
    expect(
      matchesHotkey(keyEvent({ key: ' ', code: 'Space' }), 'Ctrl+Shift+Space'),
    ).toBe(false);
  });

  it('修饰键必须完全一致，多按也不算', () => {
    expect(
      matchesHotkey(
        keyEvent({
          key: 'k',
          code: 'KeyK',
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
        'Ctrl+Shift+K',
      ),
    ).toBe(false);
  });

  it('支持 esc 这类别名', () => {
    expect(matchesHotkey(keyEvent({ key: 'Escape' }), 'Esc')).toBe(true);
    expect(matchesHotkey(keyEvent({ key: 'Escape' }), 'Ctrl+Esc')).toBe(false);
    expect(
      matchesHotkey(keyEvent({ key: 'Escape', ctrlKey: true }), 'Ctrl+Esc'),
    ).toBe(true);
  });

  it('空快捷键不匹配任何按键', () => {
    expect(matchesHotkey(keyEvent({ key: 'a' }), '')).toBe(false);
  });
});
