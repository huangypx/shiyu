import { useEffect, useRef, useState } from 'react';

import {
  isWindowMaximised,
  minimiseWindow,
  requestClose,
  toggleMaximiseWindow,
} from '@/services/bridge';
import type { Platform } from '@/types/models';

import styles from './WindowControls.module.css';

type Props = {
  platform: Platform;
};

function MinimiseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M1 5h8" fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function MaximiseGlyph({ restored }: { restored: boolean }) {
  if (restored) {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path
          d="M3 2.5V1.5h6v6H8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
        <rect
          x="1.5"
          y="3.5"
          width="5"
          height="5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1"
        />
      </svg>
    );
  }
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect
        x="1.5"
        y="1.5"
        width="7"
        height="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path
        d="M1.5 1.5l7 7M8.5 1.5l-7 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
      />
    </svg>
  );
}

// WindowControls 是 Windows/Linux 顶带右端的窗口按钮组。窗口在这些
// 平台上本来就是 frameless，没有系统 caption 可以借用，所以点击语义、
// hover 底色和关闭键的红色都由这里决定；macOS 用原生交通灯，不渲染。
export default function WindowControls({ platform }: Props) {
  const [maximised, setMaximised] = useState(false);
  // 点击最大化后补查图标状态的那次延时：组件卸载或再次点击时要能取消，
  // 否则回调会落在已经销毁的窗口上（测试环境里表现为 unhandled rejection）。
  const maximiseSyncTimer = useRef<number | undefined>(undefined);
  const hasControls = platform === 'windows' || platform === 'linux';

  useEffect(
    () => () => {
      window.clearTimeout(maximiseSyncTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (!hasControls) return;
    let cancelled = false;
    let timer: number | undefined;

    // 最大化可能由按钮以外的路径触发（双击顶带、系统窗口菜单），
    // 图标状态只能靠 resize 反查，因此挂载时先问一次，之后按
    // 80ms 节流：拖动改变尺寸时系统会连续触发 resize。
    const sync = () => {
      void isWindowMaximised().then((value) => {
        if (!cancelled) setMaximised(value);
      });
    };
    const onResize = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(sync, 80);
    };

    sync();
    window.addEventListener('resize', onResize);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [hasControls]);

  if (!hasControls) return null;

  const toggleMaximise = async () => {
    await toggleMaximiseWindow();
    // 窗口尺寸变化本身会触发 resize，但最大化到还原可能落在同一像素上，
    // 这里补一次主动查询，保证图标不会停在旧状态；重复点击先取消上一次。
    window.clearTimeout(maximiseSyncTimer.current);
    maximiseSyncTimer.current = window.setTimeout(() => {
      void isWindowMaximised().then(setMaximised);
    }, 100);
  };

  return (
    <div className={styles.controls} data-window-controls>
      <button
        type="button"
        className={styles.control}
        aria-label="最小化"
        title="最小化"
        onClick={() => void minimiseWindow()}
      >
        <MinimiseGlyph />
      </button>
      <button
        type="button"
        className={styles.control}
        aria-label={maximised ? '还原' : '最大化'}
        title={maximised ? '还原' : '最大化'}
        onClick={() => void toggleMaximise()}
      >
        <MaximiseGlyph restored={maximised} />
      </button>
      <button
        type="button"
        className={`${styles.control} ${styles.close}`}
        aria-label="关闭拾语"
        title="关闭拾语"
        onClick={() => void requestClose()}
      >
        <CloseGlyph />
      </button>
    </div>
  );
}
