import { useEffect } from 'react';

import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

// 原生应用快捷键。浏览器预览里跳过这些处理，
// Cmd/Ctrl+N 在桌面外壳之外保持浏览器的含义。
export function useAppShortcuts() {
  const platform = useDesktopStore((state) => state.runtime.platform);

  useEffect(() => {
    if (platform === 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.key === ',') {
        event.preventDefault();
        useUiStore.getState().openSettings();
        return;
      }
      if (event.key.toLowerCase() === 'n' && !event.shiftKey) {
        event.preventDefault();
        useSessionStore.getState().resetDraft();
        useUiStore.getState().notify('已清空');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [platform]);
}
