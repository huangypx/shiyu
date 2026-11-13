import { useCallback } from 'react';

import { useDesktopStore } from '@/store/desktopStore';
import { type NoticeTone, useUiStore } from '@/store/uiStore';

// 主窗口用 Toast；浮动球只有 92x92、底部胶囊马上消失，Toast 都来不及
// 读，因此按当前窗口模式退化成球体闪烁或圆内闪示。
export function useFeedback() {
  const mode = useDesktopStore((state) => state.runtime.mode);
  const notify = useUiStore((state) => state.notify);
  const flashBubble = useUiStore((state) => state.flashBubble);
  const flashOverlay = useUiStore((state) => state.flashOverlay);

  return useCallback(
    (message: string, tone: NoticeTone = 'success') => {
      if (mode === 'bubble') {
        flashBubble(tone);
        return;
      }
      if (mode === 'overlay') {
        flashOverlay(tone);
        return;
      }
      notify(message, tone);
    },
    [flashBubble, flashOverlay, mode, notify],
  );
}
