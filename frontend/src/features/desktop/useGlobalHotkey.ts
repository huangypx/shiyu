import { useEffect } from 'react';

import { matchesHotkey } from '@/features/desktop/hotkey';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { subscribeDesktopHotkey } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';

// 两条路径触发同一条录音流程：Go 侧注册的全局快捷键，
// 以及窗口内的按键匹配。全局注册成功的平台上不再重复响应。
export function useGlobalHotkey(onTrigger: () => void) {
  const hotkey = useSettingsStore((state) => state.desktop.hotkey);
  const hotkeyRegistered = useDesktopStore(
    (state) => state.runtime.hotkeyRegistered,
  );

  useEffect(() => subscribeDesktopHotkey(onTrigger), [onTrigger]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (hotkeyRegistered || !matchesHotkey(event, hotkey)) return;
      event.preventDefault();
      onTrigger();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey, hotkeyRegistered, onTrigger]);
}
