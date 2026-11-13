import { useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import {
  enterBubble,
  openSettingsWindow as requestOpenSettings,
  showMainWindow,
} from '@/services/bridge';

export function useWindowActions() {
  const feedback = useFeedback();
  return useMemo(
    () => ({
      // 窗口互相独立：收起是销毁主窗口并新建悬浮球，不再做尺寸过渡。
      collapseWindow: async () => {
        try {
          await enterBubble();
        } catch {
          feedback('暂时无法收进悬浮球');
        }
      },
      expandWindow: async () => {
        try {
          await showMainWindow();
        } catch {
          feedback('暂时无法展开桌面窗口');
        }
      },
      openSettingsWindow: async () => {
        try {
          await requestOpenSettings();
        } catch {
          feedback('暂时无法打开偏好设置');
        }
      },
    }),
    [feedback],
  );
}
