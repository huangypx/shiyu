import { useEffect } from 'react';

import { setSessionStatus } from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';

// 把录音会话状态同步给宿主：胶囊隐藏定时器靠它（托盘图标静态，不随
// 录音变化）。只在 App 挂载一次，用 subscribe 而非渲染订阅，状态变化
// 不会重渲染整棵外壳；只在 status 真正变化时上报，避免增量文本等字段刷屏。
export function useSessionStatusBridge() {
  useEffect(() => {
    // 补发一次当前状态：宿主隐藏定时器从一开始就与前端对齐。
    void setSessionStatus(useSessionStore.getState().status)?.catch(
      () => undefined,
    );
    return useSessionStore.subscribe((state, previous) => {
      if (state.status === previous.status) return;
      void setSessionStatus(state.status)?.catch(() => undefined);
    });
  }, []);
}
