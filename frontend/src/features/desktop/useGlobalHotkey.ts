import { useEffect, useLayoutEffect, useRef } from 'react';

import { matchesHotkey } from '@/features/desktop/hotkey';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { subscribeDesktopHotkey } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';

// 两条路径触发同一条录音流程：Go 侧注册的全局快捷键，
// 以及窗口内的按键匹配。全局注册成功的平台上不再重复响应。
export function useGlobalHotkey(onTrigger: (target?: string) => void) {
  const hotkey = useSettingsStore((state) => state.desktop.hotkey);
  const hotkeyRegistered = useDesktopStore(
    (state) => state.runtime.hotkeyRegistered,
  );
  const trigger = useRef(onTrigger);
  useLayoutEffect(() => {
    trigger.current = onTrigger;
  }, [onTrigger]);

  useEffect(
    () =>
      subscribeDesktopHotkey((mode, target) => {
        if (
          mode === 'main' &&
          document.activeElement?.id === 'recording-hotkey'
        ) {
          // 被系统接管的快捷键不会再产生网页按键事件，直接填入按下的组合。
          const registered = useDesktopStore.getState().runtime.hotkey;
          if (registered)
            useSettingsStore.getState().patchDesktop({ hotkey: registered });
          return;
        }
        // 原生窗口切换和录音事件可能相邻到达，先确定本次录音的投递方式。
        useDesktopStore.getState().setRuntime({ mode });
        trigger.current(target);
      }),
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.repeat ||
        document.activeElement?.id === 'recording-hotkey' ||
        useDesktopStore.getState().runtime.closeRequested ||
        hotkeyRegistered ||
        !matchesHotkey(event, hotkey)
      )
        return;
      event.preventDefault();
      onTrigger();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [hotkey, hotkeyRegistered, onTrigger]);
}
