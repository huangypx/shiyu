import { useEffect } from 'react';

import {
  loadDesktopState,
  subscribeDesktopSettings,
  subscribeDesktopState,
} from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

// 控制器是桌面状态的唯一来源：启动时拉一次，之后靠事件同步。
export function useDesktopBridge() {
  const setRuntime = useDesktopStore((state) => state.setRuntime);
  const platform = useDesktopStore((state) => state.runtime.platform);
  const backdrop = useDesktopStore((state) => state.runtime.backdrop);

  useEffect(() => {
    void loadDesktopState()
      .then((remote) => remote && setRuntime(remote))
      .catch(() => undefined);
    const unsubscribeState = subscribeDesktopState((state) =>
      setRuntime(state),
    );
    // 控制器从外部打开了偏好设置（浮动窗右键菜单），
    // 这里只负责把弹窗打开。
    const unsubscribeSettings = subscribeDesktopSettings(() =>
      useUiStore.getState().openSettings(),
    );
    return () => {
      unsubscribeState();
      unsubscribeSettings();
    };
  }, [setRuntime]);

  // 平台与材质由 main.tsx 在首帧前先写一次，控制器返回后
  // 会用真实能力覆盖。
  useEffect(() => {
    document.documentElement.dataset.platform = platform;
    document.documentElement.dataset.backdrop = backdrop;
  }, [backdrop, platform]);
}
