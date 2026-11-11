import type { MouseEvent } from 'react';
import { useCallback } from 'react';

import { toggleMaximiseWindow } from '@/services/bridge';

// 顶带是自绘标题栏：没有系统 caption，双击最大化必须自己补。
// Wails 运行时对 macOS 会拦下 dblclick，Windows/Linux 不受影响。
// 按钮和窗口按钮各自带点击语义，必须排除——否则双击关闭键会先最大化。
export function useTitlebarDoubleClick(enabled = true) {
  return useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!enabled) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('button, a, [data-window-controls]')) return;
      void toggleMaximiseWindow();
    },
    [enabled],
  );
}
