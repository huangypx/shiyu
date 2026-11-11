// 窗口内快捷键：全局快捷键由 Go 侧注册，浏览器预览和
// 注册失败的平台靠这里兜底，两边必须解析同一套写法。
export function matchesHotkey(event: KeyboardEvent, hotkey: string) {
  const parts = hotkey
    .toLowerCase()
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean);
  const key = parts[parts.length - 1];
  if (!key) return false;
  const modifiers = new Set(parts.slice(0, -1));
  const normalizedKey = event.key.toLowerCase();
  const normalizedCode = event.code.toLowerCase().replace(/^key/, '');
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
        modifiers.has('cmd') ||
        modifiers.has('command'))
  );
}
