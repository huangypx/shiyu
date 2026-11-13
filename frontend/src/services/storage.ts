// localStorage 从桌面端的持久化入口退成了浏览器预览的兜底。
// 桌面端的配置在 ~/.shiyu/config.json、历史在 history.db；
// 没有 Wails 运行时时才回落到这里，免得预览页一片空白。
// key 名沿用改名前的旧值（typeless-*），属于历史包袱：浏览器预览里
// 存着用户改过的配置和草稿历史，改名时一并换 key 会让这些数据凭空消失。

export const SETTINGS_KEY = 'typeless-settings';
export const DESKTOP_SETTINGS_KEY = 'typeless-desktop-settings';
// NOTES_KEY 现在只在浏览器预览里写入，桌面端首次启动会把它迁移进 SQLite。
export const NOTES_KEY = 'typeless-notes';
export const APPEARANCE_KEY = 'typeless-appearance';
// 侧栏在桌面端是「折叠/展开」的布局状态，重启后应该保持原样，
// 否则每次启动都要重新收起一次。
export const SIDEBAR_KEY = 'typeless-sidebar';
// 记录页两栏的宽度比例也是布局状态：拖过一次就该记住，
// 下次打开不用再拖。
export const RECORD_SPLIT_KEY = 'typeless-record-split';

export function readStoredObject<T extends object>(
  key: string,
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return { ...fallback, ...(parsed as Partial<T>) };
  } catch {
    return fallback;
  }
}

export function readStoredList<T>(key: string, fallback: T[]): T[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式或配额用尽时写入会失败，界面仍可继续使用。
  }
}

// removeStored 只在迁移成功后调用：先确认数据已经进了 SQLite，
// 再删本地副本，顺序反了就等于丢数据。
export function removeStored(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    // 删不掉不影响使用，下次启动会再尝试一次。
  }
}
