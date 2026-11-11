import type { Backdrop, Platform } from '@/types/models';

type HostBridge = {
  _wails?: { environment?: { OS?: string } };
};

// hostPlatform 只认宿主注入的 window._wails.environment：Wails 在
// documentStart 写入 {OS, Arch, Debug}。不能只看 window._wails 是否
// 存在——前端的 @wailsio/runtime 在普通浏览器里也会创建这个对象
// （事件派发、拖拽、invoke 转发），把它当桌面信号会让 Vite 预览
// 也空出一块留给交通灯的位置。
export function hostPlatform(): Platform | undefined {
  if (typeof window === 'undefined') return undefined;
  const os = (window as Window & HostBridge)._wails?.environment?.OS;
  if (!os) return undefined;
  if (os === 'darwin') return 'darwin';
  if (os === 'windows') return 'windows';
  // linux/android/ios 都走无边框窗口，统一按 Linux 的 caption 处理。
  return 'linux';
}

export function detectPlatform(): Platform {
  if (typeof window === 'undefined') return 'web';
  // 在普通浏览器里做视觉评审：?platform=windows 可以渲染
  // 自绘标题栏，不必真的有一台 Windows 机器。
  const forced = new URLSearchParams(window.location.search).get('platform');
  if (
    forced === 'darwin' ||
    forced === 'windows' ||
    forced === 'linux' ||
    forced === 'web'
  ) {
    return forced;
  }
  return hostPlatform() ?? 'web';
}

// 在 GetState 返回前使用，首帧就已经为标题栏和
// 半透明侧栏留出正确的空间。
export function defaultBackdrop(platform: Platform): Backdrop {
  switch (platform) {
    case 'darwin':
      return 'vibrancy';
    case 'windows':
      return 'mica';
    default:
      return 'none';
  }
}
