import { useEffect, useRef } from 'react';

import { setBubbleActivity } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

const DISPLAY_MS = 5000;

export function useBubbleActivity() {
  const inBubble = useDesktopStore((state) => state.runtime.mode === 'bubble');
  const status = useSessionStore((state) => state.status);
  const result = useSessionStore((state) => state.bubbleResult);
  const notice = useUiStore((state) => (inBubble ? state.notice : null));
  const visible = status !== 'idle' || Boolean(result || notice);
  const pending = useRef(Promise.resolve());

  useEffect(() => {
    if (!inBubble) return;
    // 原生调用异步完成，新的录音必须排在上一条隐藏请求之后。
    let current = true;
    pending.current = pending.current
      .then(async () => {
        if (current) await setBubbleActivity(visible);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [inBubble, visible, notice, result, status]);

  useEffect(() => {
    if (status !== 'idle' || !result) return;
    // 主窗口与小球共用会话。打开历史页也不能让过期的结果再次弹出。
    const timer = window.setTimeout(() => {
      const session = useSessionStore.getState();
      if (session.status === 'idle' && session.bubbleResult === result)
        session.setBubbleResult('');
    }, DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [result, status]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      if (useUiStore.getState().notice === notice)
        useUiStore.getState().dismissNotice();
    }, DISPLAY_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return visible;
}
