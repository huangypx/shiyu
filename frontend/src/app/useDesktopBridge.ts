import { useEffect } from 'react';

import { loadDesktopState, subscribeDesktopState } from '@/services/bridge';
import { detectPlatform } from '@/services/platform';
import { useDesktopStore } from '@/store/desktopStore';

// 控制器是桌面状态的唯一来源：启动时拉一次，之后靠事件同步。
// 每个窗口都独立挂载，但读的是同一份 Go 状态。
export function useDesktopBridge() {
  const setRuntime = useDesktopStore((state) => state.setRuntime);
  const platform = useDesktopStore((state) => state.runtime.platform);
  const backdrop = useDesktopStore((state) => state.runtime.backdrop);

  useEffect(() => {
    void loadDesktopState()
      .then((remote) => remote && setRuntime(remote))
      .catch(() => undefined);
    const unsubscribe = subscribeDesktopState((state) => setRuntime(state));
    return unsubscribe;
  }, [setRuntime]);

  // 平台来自 window._wails.environment，它在开发代理和热更新后可能
  // 比首帧晚到；Controller.GetState 也可能迟迟不返回。这里做一次
  // 有上限的校正：宿主平台一出现就补上，浏览器预览则原样不动。
  useEffect(() => {
    let attempts = 0;
    let timer = 0;
    const sync = () => {
      const detected = detectPlatform();
      if (detected !== 'web') {
        if (detected !== useDesktopStore.getState().runtime.platform) {
          setRuntime({ platform: detected });
        }
        return;
      }
      attempts += 1;
      if (attempts <= 10) timer = window.setTimeout(sync, 100);
    };
    sync();
    return () => window.clearTimeout(timer);
  }, [setRuntime]);

  useEffect(() => {
    document.documentElement.dataset.platform = platform;
    document.documentElement.dataset.backdrop = backdrop;
  }, [backdrop, platform]);
}
