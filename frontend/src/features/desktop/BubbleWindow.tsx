import {
  LoaderCircle,
  Maximize2,
  Mic,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';

import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import { saveBubblePosition } from '@/services/bridge';

import styles from './BubbleWindow.module.css';
import { useWindowTransitionStore } from './windowTransitionStore';

declare global {
  interface Window {
    // 原生悬停桥入口：desktop/hover_darwin.go 会在鼠标进出窗口时
    // 调用 __shiyuBubbleHover，移动时调用 __shiyuBubblePointer。
    // 应用失焦时 WebKit 不更新 CSS :hover，逐按钮高亮只能靠坐标
    // 命中测试。
    __shiyuBubbleHover?: (active: boolean) => void;
    __shiyuBubblePointer?: (x: number, y: number) => void;
  }
}

type Props = {
  // 麦克风还没确认可用时不能显示录音态，否则用户会以为
  // 自己说的话已经被录进去了。
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  flash: 'success' | 'error' | '';
  onToggle: () => void;
  onExpand: () => void;
  onCancel: () => void;
  onOpenSettings: () => void;
};

// 超过这个位移就把点击当成窗口拖拽。
const DRAG_THRESHOLD = 4;
// 短于这个时长的按压即使指针略有漂移也算点击。
const CLICK_MAX_DURATION = 400;
// 第一下轻点后要关掉原生拖拽区，第二下才不会落到 macOS 的标题栏
// 双击手势上；保护时间必须覆盖系统双击窗口。
const DRAG_REARM_DELAY = 500;

// 右键到原生菜单真正进入跟踪之间还有几毫秒空档，这段时间里
// 页面仍可能收到菜单打开前的移动事件；太早解除守卫等于没关。
const MENU_HOLD_SETTLE = 120;

// 拖拽区被临时关掉的原因：tap 覆盖系统双击窗口；menu 要等原生
// 菜单关闭、左键确认抬起后才恢复。
type DragHold = 'tap' | 'menu';

export default function BubbleWindow({
  isArming,
  isRecording,
  isProcessing,
  flash,
  onToggle,
  onExpand,
  onCancel,
  onOpenSettings,
}: Props) {
  const rearmTimer = useRef<number | null>(null);
  const press = useRef<{
    startedAt: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const positionPoller = useRef<number | null>(null);
  const pollGuard = useRef<number | null>(null);
  // 与 rearmTimer 共用同一个 CSS 变量，必须记录当前是谁关掉的。
  const dragHold = useRef<DragHold | null>(null);
  // 右键发生的时刻，用于跳过菜单打开前的那段空档。
  const menuHoldAt = useRef(0);
  // 音量写在外壳上：球体和音晕都读同一个变量，音晕又不受
  // 球体缩放影响，放大后仍能完整落在 92x92 的球区里。
  const shellRef = useRef<HTMLElement>(null);
  const transition = useWindowTransitionStore((state) => state.transition);
  const leaving = transition?.direction === 'expand';
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
      if (rearmTimer.current !== null) {
        window.clearTimeout(rearmTimer.current);
        rearmTimer.current = null;
      }
      stopPositionPolling();
    },
    [],
  );

  // 应用失焦时 WebKit 不会更新 :hover；原生桥进入/离开窗口时
  // 只改 shell 上的一个属性，避免每次悬停都触发 React 渲染。
  useEffect(() => {
    window.__shiyuBubbleHover = (active) => {
      const shell = shellRef.current;
      if (!shell) return;
      if (active) {
        shell.setAttribute('data-hover', 'true');
        return;
      }
      shell.removeAttribute('data-hover');
      shell.querySelectorAll('[data-hovered]').forEach((node) => {
        node.removeAttribute('data-hovered');
      });
    };
    // 失焦时 CSS :hover 不会更新；原生桥把指针坐标送进来，页面用
    // elementFromPoint 自己做命中测试，只改属性、不触发重渲染。
    window.__shiyuBubblePointer = (x, y) => {
      const shell = shellRef.current;
      if (!shell) return;
      const target = document
        .elementFromPoint(x, y)
        ?.closest('[data-bubble-action]') as HTMLElement | null;
      shell.querySelectorAll('[data-hovered]').forEach((node) => {
        if (node !== target) node.removeAttribute('data-hovered');
      });
      target?.setAttribute('data-hovered', 'true');
    };
    return () => {
      delete window.__shiyuBubbleHover;
      delete window.__shiyuBubblePointer;
    };
  }, []);

  // 只改 shell 上的内联变量：按钮和图标都继承它，拖拽区仍
  // 由第一下 mousedown 时的 drag 值启动。
  const setDragDisabled = useCallback((disabled: boolean) => {
    shellRef.current?.style.setProperty(
      '--wails-draggable',
      disabled ? 'no-drag' : 'drag',
    );
  }, []);

  const releaseDrag = useCallback(
    (hold: DragHold) => {
      // 只有持有者自己能恢复拖拽区：轻点的 500ms 兜底计时不能把
      // 仍在进行中的菜单会话提前打开。
      if (dragHold.current !== hold) return;
      dragHold.current = null;
      if (rearmTimer.current !== null) {
        window.clearTimeout(rearmTimer.current);
        rearmTimer.current = null;
      }
      setDragDisabled(false);
    },
    [setDragDisabled],
  );

  const holdDrag = useCallback(
    (hold: DragHold) => {
      // 新的保持状态接管前先清掉旧计时器，否则轻点留下的兜底
      // 会在菜单还开着的时候把拖拽区打开。
      if (rearmTimer.current !== null) {
        window.clearTimeout(rearmTimer.current);
        rearmTimer.current = null;
      }
      dragHold.current = hold;
      if (hold === 'menu') menuHoldAt.current = Date.now();
      setDragDisabled(true);
      if (hold !== 'tap') return;
      rearmTimer.current = window.setTimeout(() => {
        rearmTimer.current = null;
        releaseDrag('tap');
      }, DRAG_REARM_DELAY);
    },
    [releaseDrag, setDragDisabled],
  );

  // 菜单弹出期间页面收不到鼠标事件；关闭菜单的那一下又可能只以
  // mouseup/mousemove 到达。Wails 的拖拽区只看 DOM 里的 buttons，
  // 会把这种「看不到按下、只看得到移动」的事件合成一次拖拽，并用
  // 上一次 NSMouseDown 的锚点把窗口拽到指针处。因此在出现一次能
  // 证明左键已经抬起的鼠标事件之前，一直保持 no-drag。
  useEffect(() => {
    const settleMenuHold = (event: MouseEvent) => {
      if (dragHold.current !== 'menu') return;
      if (event.type === 'mousedown') return;
      if (event.type === 'mouseup') {
        if (event.button === 0) releaseDrag('menu');
        return;
      }
      // 没有左键按下的移动说明这次按压已经结束；但要等过菜单
      // 打开前的空档，别把右键瞬间的移动误当成菜单已关闭。
      if (
        (event.buttons & 1) === 0 &&
        Date.now() - menuHoldAt.current >= MENU_HOLD_SETTLE
      ) {
        releaseDrag('menu');
      }
    };
    // 点其他应用关闭菜单时页面收不到任何事件；失焦说明菜单已经
    // 关闭，而且那一下按压不可能还留在本窗口里。
    const releaseOnBlur = () => releaseDrag('menu');

    window.addEventListener('mousedown', settleMenuHold, true);
    window.addEventListener('mousemove', settleMenuHold, true);
    window.addEventListener('mouseup', settleMenuHold, true);
    window.addEventListener('blur', releaseOnBlur);
    return () => {
      window.removeEventListener('mousedown', settleMenuHold, true);
      window.removeEventListener('mousemove', settleMenuHold, true);
      window.removeEventListener('mouseup', settleMenuHold, true);
      window.removeEventListener('blur', releaseOnBlur);
    };
  }, [releaseDrag]);

  // 原生菜单的跟踪循环会吞掉关闭菜单那一下的按下/抬起配对，
  // 这里先一步把拖拽区关掉，避免 Wails 从残留事件合成拖拽。
  const handleContextMenu = () => {
    holdDrag('menu');
  };

  const handleTap = () => {
    // 菜单会话里到达的点击只是用来关闭菜单，不能当成录音开关。
    if (dragHold.current === 'menu') return;
    // 第一下轻点后立刻关掉拖拽区：第二下 mousedown/dblclick
    // 落到 no-drag 上，Wails 不会再调用原生标题栏双击。
    holdDrag('tap');
    // 双击展开已经移除，单击不再需要等待双击判定，直接生效。
    onToggle();
  };

  // 按钮位于原生拖拽区域里，浏览器在按下后不会派发 click：
  // 因此改用 mouseup 判断轻点，有位移的按压视为拖拽结束。
  const handleMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    // 关闭菜单的那一次按压不参与轮询，也不能在 mouseup 时
    // 被当成轻点去切换录音。
    if (dragHold.current === 'menu') return;
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
      // 原生拖拽移动了窗口，记下它落在哪里。拖动不算一次点击。
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
  // 录音开始后只保留取消：展开和设置要等这次录音结束或取消，
  // 避免用户在录音中误触到别的动作。
  const isActive = isArming || isRecording || isProcessing;

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-state={state}
      data-leaving={leaving ? 'true' : undefined}
      aria-label="拾语浮动录音按钮"
      // 右键时先关掉拖拽区，菜单关闭后再由鼠标状态恢复。
      onContextMenu={handleContextMenu}
      // 放在外壳上让圆圈的透明边缘和 SVG 图标也能继承；
      // 右键菜单仍由 Wails v3 的原生 ContextMenu 绘制。
      style={{ '--custom-contextmenu': 'bubble-menu' } as React.CSSProperties}
    >
      <div className={styles.ball}>
        {/* 音晕与呼吸环单独成元素而不是伪元素：伪元素会叠加
            按钮自身的缩放，最大音量时被 92x92 的球区裁掉。 */}
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
          style={
            { '--custom-contextmenu': 'bubble-menu' } as React.CSSProperties
          }
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
                  : '开始录音'
          }
          title={
            isProcessing
              ? '正在整理… · 悬停可取消'
              : isArming
                ? '正在开启麦克风… · 悬停可取消'
                : isRecording
                  ? '单击结束录音 · 悬停显示操作 · 右键隐藏'
                  : '单击开始录音 · 悬停显示操作 · 右键隐藏'
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
      </div>

      {/* 悬停工具栏的容器始终接收指针并退出拖拽区：球下方的透明条
          不能变成第二个拖拽手柄。待录音时显示展开和设置，开始录音
          后只保留取消。 */}
      <div className={styles.toolbar} role="toolbar" aria-label="浮动球操作">
        <div className={styles.toolbarPill}>
          {isActive ? (
            <button
              type="button"
              className={styles.toolbarButton}
              data-bubble-action="cancel"
              aria-label="取消这段转写"
              title="取消这段转写"
              onClick={onCancel}
            >
              <X size={14} />
            </button>
          ) : (
            <>
              <button
                type="button"
                className={styles.toolbarButton}
                data-bubble-action="expand"
                aria-label="展开主窗口"
                title="展开主窗口"
                onClick={onExpand}
              >
                <Maximize2 size={14} />
              </button>
              <button
                type="button"
                className={styles.toolbarButton}
                data-bubble-action="settings"
                aria-label="打开偏好设置"
                title="打开偏好设置"
                onClick={onOpenSettings}
              >
                <Settings size={14} />
              </button>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
