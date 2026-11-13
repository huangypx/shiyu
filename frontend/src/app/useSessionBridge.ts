import { useEffect } from 'react';

import {
  getSession,
  type SessionSnapshot,
  subscribeDesktopSession,
} from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';

// Go 是会话状态的唯一来源。窗口挂载时先订阅再拉一次，避免
// 订阅前的更新丢失；revision 保证乱序事件不会把新状态写回旧值。
export function useSessionBridge() {
  useEffect(() => {
    let disposed = false;
    const apply = (snapshot: SessionSnapshot) => {
      if (!disposed) useSessionStore.getState().applySnapshot(snapshot);
    };
    const unsubscribe = subscribeDesktopSession(apply);
    void getSession()
      .then((snapshot) => {
        if (snapshot) apply(snapshot);
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
