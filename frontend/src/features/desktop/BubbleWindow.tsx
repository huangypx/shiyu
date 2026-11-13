import { Check, Copy, LoaderCircle, Mic, Square } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef } from 'react';

import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import { Waveform } from '@/features/recorder/Waveform';
import { resizeBubble, saveBubblePosition } from '@/services/bridge';
import type { Notice } from '@/store/uiStore';

import styles from './BubbleWindow.module.css';

type Props = {
  // 麦克风还没确认可用时不能显示录音态，否则用户会以为
  // 自己说的话已经被录进去了。
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  result: string;
  copied: boolean;
  notice: Notice | null;
  onCopy: () => void;
  onToggle: () => void;
  onExpand: () => void;
};

// 必须区分双击和两次单击，因此录音切换要等这个窗口过去才触发。
const CLICK_DELAY = 260;
// 超过这个位移就把点击当成窗口拖拽。
const DRAG_THRESHOLD = 4;
// 短于这个时长的按压即使指针略有漂移也算点击。
const CLICK_MAX_DURATION = 400;

export default function BubbleWindow({
  isArming,
  isRecording,
  isProcessing,
  result,
  copied,
  notice,
  onCopy,
  onToggle,
  onExpand,
}: Props) {
  const visible =
    isArming || isRecording || isProcessing || Boolean(result || notice);
  const clickTimer = useRef<number | null>(null);
  const lastClickAt = useRef(0);
  const press = useRef<{
    startedAt: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const positionPoller = useRef<number | null>(null);
  const pollGuard = useRef<number | null>(null);
  const shellRef = useRef<HTMLElement>(null);
  useMicLevelVar(shellRef);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;
    const viewport = document.documentElement;
    viewport.classList.add(styles.viewport);
    let live = true;
    let requests = Promise.resolve();
    const syncSize = () => {
      requests = requests
        .then(async () => {
          if (live) {
            const { width, height } = shell.getBoundingClientRect();
            if (width && height)
              await resizeBubble(Math.ceil(width), Math.ceil(height));
          }
        })
        .catch(() => undefined);
    };
    const observer = new ResizeObserver(syncSize);
    observer.observe(shell);
    syncSize();
    return () => {
      live = false;
      observer.disconnect();
      viewport.classList.remove(styles.viewport);
    };
  }, [visible]);

  const stopPositionPolling = () => {
    if (positionPoller.current !== null) {
      window.clearInterval(positionPoller.current);
      positionPoller.current = null;
    }
    if (pollGuard.current !== null) {
      window.clearTimeout(pollGuard.current);
      pollGuard.current = null;
    }
  };

  // 窗口拖拽由系统处理，结束拖拽的 mouse-up 不会到达页面。
  // 因此在按压期间持续保存位置，并在 mouse-up 或兜底延时后停止。
  const startPositionPolling = () => {
    stopPositionPolling();
    positionPoller.current = window.setInterval(() => {
      void saveBubblePosition();
    }, 500);
    pollGuard.current = window.setTimeout(stopPositionPolling, 20000);
  };

  useEffect(
    () => () => {
      if (clickTimer.current !== null) window.clearTimeout(clickTimer.current);
      stopPositionPolling();
    },
    [],
  );

  const handleTap = () => {
    const now = Date.now();
    if (now - lastClickAt.current < CLICK_DELAY) {
      lastClickAt.current = 0;
      if (clickTimer.current !== null) {
        window.clearTimeout(clickTimer.current);
        clickTimer.current = null;
      }
      onExpand();
      return;
    }
    lastClickAt.current = now;
    clickTimer.current = window.setTimeout(() => {
      clickTimer.current = null;
      onToggle();
    }, CLICK_DELAY);
  };

  // 按钮位于原生拖拽区域里，浏览器在按下后不会派发 click：
  // 因此改用 mouseup 判断轻点，有位移的按压视为拖拽结束。
  const handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    press.current = {
      startedAt: Date.now(),
      x: event.screenX,
      y: event.screenY,
      moved: false,
    };
    startPositionPolling();
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLButtonElement>) => {
    const current = press.current;
    if (!current || event.buttons !== 1) return;
    const travel = Math.hypot(
      event.screenX - current.x,
      event.screenY - current.y,
    );
    if (travel < DRAG_THRESHOLD) return;
    current.moved = true;
  };

  const handleMouseUp = (event: React.MouseEvent<HTMLButtonElement>) => {
    const current = press.current;
    press.current = null;
    stopPositionPolling();
    if (!current || event.button !== 0) return;
    if (current.moved) {
      // 原生拖拽移动了窗口，记下它落在哪里。
      void saveBubblePosition();
      return;
    }
    if (Date.now() - current.startedAt > CLICK_MAX_DURATION) return;
    handleTap();
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // 键盘激活（Enter/Space）的 detail 为 0；鼠标点击在 mouseup 处理。
    if (event.detail === 0) handleTap();
  };

  const state = isProcessing
    ? 'processing'
    : isArming
      ? 'arming'
      : isRecording
        ? 'recording'
        : result
          ? 'result'
          : 'notice';
  if (!visible) return null;
  const visibleNotice =
    state === 'notice' || notice?.tone === 'error' ? notice : null;
  const canDrag = state === 'result' || state === 'notice';
  const label = isProcessing
    ? '正在整理文字'
    : isArming
      ? '正在开启麦克风，单击取消'
      : isRecording
        ? '结束录音'
        : '开始录音，双击展开主窗口';

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-state={state}
      data-draggable={canDrag || undefined}
      aria-label="拾语浮动录音按钮"
      style={{ '--custom-contextmenu': 'bubble-menu' } as React.CSSProperties}
    >
      <div className={styles.surface}>
        <button
          type="button"
          className={styles.control}
          aria-label={label}
          aria-disabled={isProcessing}
          onMouseDown={canDrag ? handleMouseDown : undefined}
          onMouseMove={canDrag ? handleMouseMove : undefined}
          onMouseUp={canDrag ? handleMouseUp : undefined}
          onClick={
            canDrag
              ? handleClick
              : () => {
                  if (!isProcessing) onToggle();
                }
          }
        >
          {isProcessing || isArming ? (
            <LoaderCircle className="spin" size={19} />
          ) : isRecording ? (
            <>
              <Waveform className={styles.wave} active />
              <Square size={12} fill="currentColor" />
            </>
          ) : (
            <Mic size={19} />
          )}
        </button>
        {(state === 'result' || visibleNotice) && (
          <div className={styles.body}>
            {visibleNotice && (
              <p
                role={visibleNotice.tone === 'error' ? 'alert' : 'status'}
                className={styles.notice}
              >
                {visibleNotice.message}
              </p>
            )}
            {state === 'result' && (
              <p className={styles.result} aria-label="整理结果">
                {result}
              </p>
            )}
          </div>
        )}
        {state === 'result' && (
          <button
            type="button"
            className={styles.copy}
            onClick={onCopy}
            aria-label={copied ? '已复制' : '复制结果'}
          >
            {copied ? <Check size={17} /> : <Copy size={16} />}
          </button>
        )}
      </div>
    </main>
  );
}
