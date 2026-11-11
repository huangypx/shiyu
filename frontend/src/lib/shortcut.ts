import type { Platform } from '@/types/models';

// 快捷键逻辑同时接受 metaKey 与 ctrlKey（见 useAppShortcuts），但界面
// 只能显示其中一颗：macOS 写 ⌘，Windows/Linux 写 Ctrl+。写死 ⌘ 会让
// Windows 用户去找一颗键盘上不存在的键。
export function formatShortcut(platform: Platform, key: string): string {
  return platform === 'darwin' ? `⌘${key}` : `Ctrl+${key}`;
}
