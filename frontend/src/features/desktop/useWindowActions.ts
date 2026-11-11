import { useMemo } from 'react';

import { useFeedback } from '@/app/useFeedback';
import {
  openSettingsWindow as requestOpenSettings,
  showMainWindow,
  toggleDesktopMode,
} from '@/services/bridge';

export function useWindowActions() {
  const feedback = useFeedback();
  return useMemo(
    () => ({
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
      toggleWindowMode: async () => {
        try {
          await toggleDesktopMode();
        } catch {
          feedback('浮动窗口需要在桌面应用中使用');
        }
      },
    }),
    [feedback],
  );
}
