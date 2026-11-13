import { useEffect } from 'react';

import { useFeedback } from '@/app/useFeedback';
import { subscribeDesktopNotice } from '@/services/bridge';

// Go 流水线完成后统一发 desktop:notice；每个窗口按自己的角色
// 决定显示 Toast 还是闪烁。
export function useDesktopNotices() {
  const feedback = useFeedback();
  useEffect(
    () =>
      subscribeDesktopNotice((message, tone) => {
        feedback(message, tone);
      }),
    [feedback],
  );
}
