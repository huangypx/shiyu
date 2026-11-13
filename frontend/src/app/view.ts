export type DesktopView = 'main' | 'bubble' | 'overlay';

// 三个窗口共用同一份前端资源，view 参数决定这个窗口渲染哪一部分。
// 浏览器预览没有参数，退回主窗口。
export function readDesktopView(): DesktopView {
  if (typeof window === 'undefined') return 'main';
  const value = new URLSearchParams(window.location.search).get('view');
  return value === 'bubble' || value === 'overlay' ? value : 'main';
}

export const desktopView = readDesktopView();
