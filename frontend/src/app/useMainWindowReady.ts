import { useLayoutEffect } from 'react';

import { markMainWindowReady } from '@/services/bridge';

// 主窗口在 Go 侧先隐藏创建，等 React 完成首次提交后才显示。
// 这里必须用 layout effect 而不是 requestAnimationFrame：隐藏窗口
// 里的 rAF 会被 WebKit 暂停，窗口可能永远等不到显示信号。
export function useMainWindowReady() {
  useLayoutEffect(() => {
    void markMainWindowReady()?.catch(() => undefined);
  }, []);
}
