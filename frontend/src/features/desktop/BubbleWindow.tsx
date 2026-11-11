import { LoaderCircle, Mic, Square } from 'lucide-react';
import { useEffect, useRef } from 'react';

import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import { saveBubblePosition } from '@/services/bridge';

import styles from './BubbleWindow.module.css';

type Props = {
  // 麦克风还没确认可用时不能显示录音态，否则用户会以为
  // 自己说的话已经被录进去了。
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  flash: 'success' | 'error' | '';
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
  flash,
  onToggle,
  onExpand,
}: Props) {
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
  // 音量写在外壳上：球体和音晕都读同一个变量，音晕又不受
  // 球体缩放影响，放大后仍能完整落在 92x92 的窗口里。
  const shellRef = useRef<HTMLElement>(null);
  useMicLevelVar(shellRef);

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
        : 'idle';

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-state={state}
      aria-label="拾语浮动录音按钮"
      // 放在外壳上让圆圈的透明边缘和 SVG 图标也能继承；
      // 右键菜单仍由 Wails v3 的原生 ContextMenu 绘制。
      style={{ '--custom-contextmenu': 'bubble-menu' } as React.CSSProperties}
    >
      {/* 音晕与呼吸环单独成元素而不是伪元素：伪元素会叠加
          按钮自身的缩放，最大音量时被 92x92 的窗口裁掉。 */}
      {state === 'recording' ? (
        <span className={styles.levelHalo} aria-hidden="true" />
      ) : null}
      {state === 'arming' ? (
        <span className={styles.armingRing} aria-hidden="true" />
      ) : null}
      <button
        type="button"
        className={[
          styles.button,
          state === 'recording' ? styles.recording : '',
          state === 'arming' ? styles.arming : '',
          state === 'processing' ? styles.processing : '',
          flash === 'success' ? styles.flashSuccess : '',
          flash === 'error' ? styles.flashError : '',
        ]
          .filter(Boolean)
          .join(' ')}
        // Wails v3 的运行时扫描这个自定义属性，右键时直接弹出
        // 系统原生菜单；菜单内容在 desktop/menu.go 注册。
        style={{ '--custom-contextmenu': 'bubble-menu' } as React.CSSProperties}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        aria-disabled={isProcessing}
        aria-label={
          isProcessing
            ? '正在整理文字'
            : isArming
              ? '正在开启麦克风，单击取消'
              : isRecording
                ? '结束录音'
                : '开始录音，双击展开主窗口'
        }
        // 右键即可取消这一段，是这次交互里唯一的地方能说明它。
        title={
          isProcessing
            ? '正在整理… · 右键可取消'
            : isArming
              ? '正在开启麦克风… · 双击展开 · 右键更多'
              : `${isRecording ? '单击结束录音' : '单击开始录音'} · 双击展开 · 右键更多`
        }
      >
        {isProcessing ? (
          <LoaderCircle className="spin" size={28} />
        ) : isRecording ? (
          <Square size={22} fill="currentColor" />
        ) : (
          <Mic size={28} />
        )}
      </button>
    </main>
  );
}
