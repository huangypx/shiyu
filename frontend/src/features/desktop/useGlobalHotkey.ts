import { useEffect, useLayoutEffect, useRef } from 'react';

import { matchesHotkey } from '@/features/desktop/hotkey';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { subscribeDesktopHotkey } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';

// 两条路径触发同一条录音流程：Go 侧注册的全局快捷键（经队列领取，
// 第一次按键不丢），以及窗口内的按键匹配。全局注册成功的平台上不再
// 重复响应网页按键。
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
