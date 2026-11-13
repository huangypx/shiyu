// 窗口内快捷键：全局快捷键由 Go 侧注册，浏览器预览和
// 注册失败的平台靠这里兜底，两边必须解析同一套写法。
export function captureHotkey(event: KeyboardEvent): string | undefined {
  if (event.code === 'AltRight') return 'Right Alt';
  if (['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'].includes(event.key))
    return;
  const modifiers = [
    event.ctrlKey && 'Ctrl',
    event.altKey && 'Alt',
    event.shiftKey && 'Shift',
    event.metaKey && 'Super',
  ].filter(Boolean);
  // 普通字符留给手动编辑；修饰组合和功能键可直接按下录入。
  if (
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !/^F(?:[1-9]|1\d|2[0-4])$/.test(event.key)
  )
    return;
  const key =
    event.code === 'Space'
      ? 'Space'
      : event.key.length === 1
        ? event.key.toUpperCase()
        : event.key.replace(/^Arrow/, '');
  return [...modifiers, key].join('+');
}

export function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const physicalKey = hotkey.toLowerCase().replace(/\s/g, '');
  if (['rightalt', 'altright', '右alt'].includes(physicalKey))
    return event.code === 'AltRight';
  const parts = hotkey
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts[parts.length - 1];
  if (!key) return false;
  const modifiers = new Set(parts.slice(0, -1));
  const normalizedKey = event.key.toLowerCase();
  const normalizedCode = event.code
    .toLowerCase()
    .replace(/^(key|arrow|digit)/, '');
  const keyMatches =
    key === normalizedKey ||
    key === normalizedCode ||
    (key === 'space' && event.code === 'Space') ||
    (key === 'esc' && event.key === 'Escape');
  if (!keyMatches) return false;
  return (
    event.ctrlKey === (modifiers.has('ctrl') || modifiers.has('control')) &&
    event.shiftKey === modifiers.has('shift') &&
    event.altKey === (modifiers.has('alt') || modifiers.has('option')) &&
    event.metaKey ===
      (modifiers.has('meta') ||
        modifiers.has('super') ||
        modifiers.has('win') ||
        modifiers.has('windows') ||
        modifiers.has('cmd') ||
        modifiers.has('command'))
  );
}
