import { useEffect } from 'react';

import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

// 浏览器预览保留系统快捷键，在桌面模式才接管设置和新建操作。
export function useAppShortcuts(newRecord: () => void) {
  const platform = useDesktopStore((state) => state.runtime.platform);

  useEffect(() => {
    if (platform === 'web') return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey)
        return;
      if (event.key === ',') {
        event.preventDefault();
        useUiStore.getState().openSettings();
      } else if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        if (
          !useUiStore.getState().settingsOpen &&
          !useDesktopStore.getState().runtime.closeRequested
        ) {
          newRecord();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [newRecord, platform]);
}
