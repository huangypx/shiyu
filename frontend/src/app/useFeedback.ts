import { useCallback } from 'react';

import { useDesktopStore } from '@/store/desktopStore';
import { type NoticeTone, useUiStore } from '@/store/uiStore';

// 主窗口用 Toast，浮动窗口只有 92x92，Toast 会被裁掉，
// 因此按当前窗口模式选择提示方式。
export function useFeedback() {
  const mode = useDesktopStore((state) => state.runtime.mode);
  const notify = useUiStore((state) => state.notify);
  const flashBubble = useUiStore((state) => state.flashBubble);

  return useCallback(
    (message: string, tone: NoticeTone = 'success') => {
      if (mode === 'bubble') {
        flashBubble(tone);
        return;
      }
      notify(message, tone);
    },
    [flashBubble, mode, notify],
  );
}
