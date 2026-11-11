import { useLayoutEffect, useRef } from 'react';

import { computeBubbleness, transitionVars } from './transitionGeometry';
import styles from './WindowTransition.module.css';
import { useWindowTransitionStore } from './windowTransitionStore';

export default function WindowTransition() {
  const transition = useWindowTransitionStore((state) => state.transition);
  const dropletRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    // 展开是「球先淡出、窗口直接在记忆位置出现」，没有水滴
    // 形变；只有收起路径需要逐帧更新水滴几何。
    if (!transition || transition.direction !== 'shrink') return;
    const element = dropletRef.current;
    if (!element) return;

    const { from, to, phase } = transition;
    // 收起的目标是悬浮球宽度；水滴末态的 inset/半径都按这个
    // 宽度算，才能和真实按钮重合。
    const bubbleWidth = to.width;

    const apply = () => {
      const bubbleness =
        phase === 'settling'
          ? 1
          : computeBubbleness(from.width, to.width, window.innerWidth);
      const vars = transitionVars(
        bubbleness,
        bubbleWidth,
        window.innerWidth,
        window.innerHeight,
      );
      element.style.setProperty('--droplet-width', `${vars.width}px`);
      element.style.setProperty('--droplet-height', `${vars.height}px`);
      element.style.setProperty('--droplet-inset', `${vars.inset}px`);
      element.style.setProperty('--droplet-radius', `${vars.radius}px`);
      element.style.setProperty('--droplet-fill', vars.fill.toFixed(3));
      element.style.setProperty('--droplet-border', vars.border.toFixed(3));
      element.style.setProperty('--droplet-shadow', vars.shadow.toFixed(3));
    };

    // 首帧必须在 commit 之后、浏览器绘制之前写进去，避免窗口
    // 尺寸变化后先用 CSS 默认尺寸画一帧。
    apply();
    if (phase === 'settling') return;

    let frame = window.requestAnimationFrame(function loop() {
      apply();
      frame = window.requestAnimationFrame(loop);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [transition]);

  if (!transition) return null;

  return (
    <div
      className={styles.overlay}
      data-window-transition={transition.direction}
      data-phase={transition.phase}
      aria-hidden="true"
    >
      {transition.direction === 'shrink' ? (
        <div
          className={styles.droplet}
          data-anchor={transition.anchor}
          ref={dropletRef}
        />
      ) : null}
    </div>
  );
}
