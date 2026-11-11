import { useEffect, useRef } from 'react';

import {
  loadDesktopState,
  setReduceMotion,
  subscribeDesktopSettings,
  subscribeDesktopState,
  subscribeDesktopTransition,
} from '@/services/bridge';
import { detectPlatform } from '@/services/platform';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import { useWindowTransitionStore } from './windowTransitionStore';

// 控制器是桌面状态的唯一来源：启动时拉一次，之后靠事件同步。
export function useDesktopBridge() {
  const setRuntime = useDesktopStore((state) => state.setRuntime);
  const platform = useDesktopStore((state) => state.runtime.platform);
  const backdrop = useDesktopStore((state) => state.runtime.backdrop);

  const settingsTimer = useRef<number | null>(null);

  useEffect(() => {
    void loadDesktopState()
      .then((remote) => remote && setRuntime(remote))
      .catch(() => undefined);
    const unsubscribeState = subscribeDesktopState((state) => {
      // 先结束遮罩再换路由：AppShell 首次挂载就必须带上
      // data-entering，否则会先以正常状态闪一帧再开始淡入。
      const { transition, settle } = useWindowTransitionStore.getState();
      if (transition?.phase === 'running') settle();
      setRuntime(state);
    });
    const unsubscribeTransition = subscribeDesktopTransition((transition) =>
      useWindowTransitionStore.getState().start(transition),
    );
    // 控制器从外部打开了偏好设置（浮动球的设置图标），
    // 这里只负责把弹窗打开。窗口还在过渡时先等落定，
    // 否则 Radix Dialog 会在缩放的窗口里被拉扯一帧。
    const unsubscribeSettings = subscribeDesktopSettings(() => {
      const transition = useWindowTransitionStore.getState().transition;
      if (!transition) {
        useUiStore.getState().openSettings();
        return;
      }
      // 展开在 160ms 后直接跳到主窗口，再留 220ms 给遮罩淡出；
      // 这里至少等 520ms，避免设置弹窗赶在遮罩还在时出现。
      const delay =
        transition.phase === 'running'
          ? Math.max(transition.durationMs + 360, 520)
          : 240;
      if (settingsTimer.current !== null) {
        window.clearTimeout(settingsTimer.current);
      }
      settingsTimer.current = window.setTimeout(() => {
        settingsTimer.current = null;
        useUiStore.getState().openSettings();
      }, delay);
    });
    return () => {
      unsubscribeState();
      unsubscribeTransition();
      unsubscribeSettings();
      if (settingsTimer.current !== null) {
        window.clearTimeout(settingsTimer.current);
        settingsTimer.current = null;
      }
    };
  }, [setRuntime]);

  // 原生窗口动画不经过 CSS，必须把系统偏好同步给 Go；否则
  // 开启「减少动态效果」后只有界面淡入淡出生效，窗口仍会逐帧移动。
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => {
      const pending = setReduceMotion(media.matches);
      void pending?.catch(() => undefined);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  // 平台来自 window._wails.environment，它在开发代理和热更新后可能
  // 比首帧晚到；Controller.GetState 也可能迟迟不返回。两种情况都会让
  // store 停在浏览器值，顶带就会空出一段本该给交通灯的位置。这里做一次
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

  // 平台与材质由 main.tsx 在首帧前先写一次，控制器返回后
  // 会用真实能力覆盖。
  useEffect(() => {
    document.documentElement.dataset.platform = platform;
    document.documentElement.dataset.backdrop = backdrop;
  }, [backdrop, platform]);
}
