import { type RefObject, useEffect } from 'react';

import { subscribeDesktopMicLevel } from '@/services/bridge';

// 音量每秒变化几十次，写进 React 状态会让整棵树重渲染；
// 改成往元素上写 CSS 变量，由样式自己插值，动画和拖拽都不掉帧。
// Go 原生采集在音频线程算好电平，再广播给所有可见窗口。
export function useMicLevelVar<T extends HTMLElement>(
  ref: RefObject<T | null>,
) {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const apply = (level: number) => {
      element.style.setProperty('--mic-level', level.toFixed(3));
    };
    apply(0);
    const unsubscribe = subscribeDesktopMicLevel(apply);
    return () => {
      unsubscribe();
      apply(0);
    };
  }, [ref]);
}
