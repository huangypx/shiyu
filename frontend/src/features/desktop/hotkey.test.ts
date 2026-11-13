import { describe, expect, it } from 'vitest';

import { captureHotkey, matchesHotkey } from './hotkey';

function keyEvent(init: KeyboardEventInit) {
  return new KeyboardEvent('keydown', init);
}

describe('matchesHotkey', () => {
  it('设置框支持直接按下快捷键，也能手动输入', () => {
    expect(
      captureHotkey(keyEvent({ key: 'Alt', code: 'AltRight', altKey: true })),
    ).toBe('Right Alt');
    const combo = keyEvent({
      key: ' ',
      code: 'Space',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(captureHotkey(combo)).toBe('Ctrl+Shift+Space');
    expect(matchesHotkey(combo, captureHotkey(combo)!)).toBe(true);
    expect(captureHotkey(keyEvent({ key: 'F8' }))).toBe('F8');
    expect(captureHotkey(keyEvent({ key: 'a' }))).toBeUndefined();
  });
  it('只在按下物理右 Alt 时匹配右 Alt 快捷键', () => {
    const right = keyEvent({ key: 'Alt', code: 'AltRight', altKey: true });
    expect(matchesHotkey(right, 'Right Alt')).toBe(true);
    expect(matchesHotkey(right, '右 Alt')).toBe(true);
    expect(
      matchesHotkey(
        keyEvent({ key: 'Alt', code: 'AltLeft', altKey: true }),
        'Right Alt',
      ),
    ).toBe(false);
  });

  it('识别 Ctrl+Shift+Space 组合键', () => {
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
