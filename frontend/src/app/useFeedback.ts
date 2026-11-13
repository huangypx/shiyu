import { useCallback } from 'react';

import { desktopView } from '@/app/view';
import { type NoticeTone, useUiStore } from '@/store/uiStore';

// 主窗口用 Toast；浮动球只有 92x92、底部胶囊马上消失，Toast 都来不及
// 读，因此按当前窗口角色退化成球体闪烁或圆内闪示。
export function useFeedback() {
  const notify = useUiStore((state) => state.notify);
  const flashBubble = useUiStore((state) => state.flashBubble);
  const flashOverlay = useUiStore((state) => state.flashOverlay);

  return useCallback(
    (message: string, tone: NoticeTone = 'success') => {
      if (desktopView === 'bubble') {
        flashBubble(tone);
        return;
      }
      if (desktopView === 'overlay') {
        flashOverlay(tone);
        return;
      }
      notify(message, tone);
    },
    [flashBubble, flashOverlay, notify],
  );
}
