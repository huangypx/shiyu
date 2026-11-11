import type { MouseEvent } from 'react';
import { useEffect, useState } from 'react';

import BrandMark from '@/components/BrandMark';
import {
  isWindowMaximised,
  minimiseWindow,
  quitApp,
  toggleMaximiseWindow,
} from '@/services/bridge';
import type { Platform } from '@/types/models';

import styles from './WindowChrome.module.css';

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

export default function WindowChrome({ platform }: Props) {
  const [maximised, setMaximised] = useState(false);
  const hasCaption = platform === 'windows' || platform === 'linux';

  useEffect(() => {
    if (!hasCaption) return;
    let timer: number | undefined;
    let cancelled = false;

    const sync = () => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        void isWindowMaximised().then((value) => {
          if (!cancelled) setMaximised(value);
        });
      }, 80);
    };

    sync();
    window.addEventListener('resize', sync);
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('resize', sync);
    };
  }, [hasCaption]);

  if (platform === 'web') return null;

  // macOS 绘制真实交通灯；这条区域只负责留出位置，
  // 并把标题栏其余部分作为拖拽手柄。
  if (platform === 'darwin') {
    return <div className={styles.chrome} aria-hidden="true" />;
  }

  const toggleMaximise = async () => {
    await toggleMaximiseWindow();
    window.setTimeout(() => {
      void isWindowMaximised().then(setMaximised);
    }, 100);
  };

  const handleDoubleClick = (event: MouseEvent<HTMLElement>) => {
    const target = event.target as HTMLElement | null;
    if (target?.closest('[data-window-controls]')) return;
    void toggleMaximise();
  };

  return (
    <header className={styles.chrome} onDoubleClick={handleDoubleClick}>
      <BrandMark size={15} className={styles.mark} />
      <span className={styles.title}>拾语</span>
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
          onClick={() => void quitApp()}
        >
          <CloseGlyph />
        </button>
      </div>
    </header>
  );
}
