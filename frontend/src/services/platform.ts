import type { Backdrop, Platform } from '@/types/models';

// 浏览器预览没有 Wails 绑定；当成 "web" 处理可以
// 让原生标题栏不出现在截图和普通 Vite 访问中。
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
  // Wails v3 在页面注入 window._wails；普通 Vite 预览没有它。
  if (!(window as Window & { _wails?: unknown })._wails) {
    return 'web';
  }
  const ua = navigator.userAgent;
  if (/Mac|iPhone|iPad|iPod/i.test(ua)) return 'darwin';
  if (/Windows/i.test(ua)) return 'windows';
  return 'linux';
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
