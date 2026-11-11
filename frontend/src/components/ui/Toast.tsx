import * as ToastPrimitive from '@radix-ui/react-toast';
import { Theme } from '@radix-ui/themes';
import { Check, TriangleAlert } from 'lucide-react';

import { useUiStore } from '@/store/uiStore';

import styles from './Toast.module.css';

// 主窗口的提示条。网络失败的原因往往很长，失败提示
// 停留更久，避免用户还没看清就消失。
export default function Toast() {
  const notice = useUiStore((state) => state.notice);
  const dismissNotice = useUiStore((state) => state.dismissNotice);
  const duration = notice?.tone === 'error' ? 5000 : 2600;

  return (
    <ToastPrimitive.Provider duration={duration} swipeDirection="down">
      {notice && (
        <ToastPrimitive.Root
          key={notice.id}
          defaultOpen
          onOpenChange={(open) => {
            if (!open) dismissNotice();
          }}
          className={
            notice.tone === 'error'
              ? `${styles.toast} ${styles.error}`
              : styles.toast
          }
        >
          <span className={styles.icon} aria-hidden="true">
            {notice.tone === 'error' ? (
              <TriangleAlert size={14} />
            ) : (
              <Check size={14} />
            )}
          </span>
          <ToastPrimitive.Description className={styles.text}>
            {notice.message}
          </ToastPrimitive.Description>
        </ToastPrimitive.Root>
      )}
      <Theme appearance="inherit">
        <ToastPrimitive.Viewport className={styles.viewport} />
      </Theme>
    </ToastPrimitive.Provider>
  );
}
