import { useEffect, useLayoutEffect, useRef } from 'react';

import { matchesHotkey } from '@/features/desktop/hotkey';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useDesktopStore } from '@/store/desktopStore';

// 全局热键由 Go 直接注册并驱动采集宿主；这里只保留窗口聚焦时
// 的键盘兜底，供注册失败或浏览器预览使用。
export function useGlobalHotkey(onTrigger: () => void) {
  const hotkey = useSettingsStore((state) => state.desktop.hotkey);
  const hotkeyRegistered = useDesktopStore(
    (state) => state.runtime.hotkeyRegistered,
  );
  const trigger = useRef(onTrigger);
  useLayoutEffect(() => {
    trigger.current = onTrigger;
  }, [onTrigger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        useDesktopStore.getState().runtime.closeRequested ||
        hotkeyRegistered ||
        !matchesHotkey(event, hotkey)
      ) {
        return;
      }
      event.preventDefault();
      trigger.current();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey, hotkeyRegistered]);
}
