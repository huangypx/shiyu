import { Check, LoaderCircle, X } from 'lucide-react';
import { useRef } from 'react';

import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import Waveform from '@/features/recorder/Waveform';

import styles from './OverlayWindow.module.css';

type Props = {
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  flash: 'success' | 'error' | '';
  onCancel: () => void;
};

// 底部胶囊是隐藏悬浮球后按热键叫出的第三形态。原生窗口固定 360x72，
// 胶囊→圆完全靠 CSS 宽度变形，不改窗口尺寸，也不抢焦点（粘贴目标
// 仍是原前台应用）。音量写在外壳上，波形与录音卡共用同一套竖条。
export default function OverlayWindow({
  isArming,
  isRecording,
  isProcessing,
  flash,
  onCancel,
}: Props) {
  const shellRef = useRef<HTMLElement>(null);
  useMicLevelVar(shellRef);

  const state = isProcessing
    ? 'processing'
    : isArming
      ? 'arming'
      : isRecording
        ? 'recording'
        : 'idle';
  // 录音开始后才出现取消；整理与闪示阶段胶囊已收成圆，不再可取消。
  const isActive = isArming || isRecording;

  return (
    <main
      ref={shellRef}
      className={styles.shell}
      data-state={state}
      data-flash={flash || undefined}
      aria-label="拾语底部录音胶囊"
    >
      <div className={styles.capsule}>
        {/* 波形与取消钮铺在胶囊里；收成圆时整行淡出，让位给旋转图标。 */}
        <div className={styles.row}>
          <Waveform
            stretch
            active={isRecording}
            processing={isProcessing}
            arming={isArming}
          />
          {isActive ? (
            <button
              type="button"
              className={styles.cancel}
              aria-label="取消这段转写"
              title="取消这段转写"
              onClick={onCancel}
            >
              <X size={16} />
            </button>
          ) : null}
        </div>

        <div className={styles.spinner} aria-hidden="true">
          <LoaderCircle className="spin" size={26} />
        </div>

        {/* 完成/取消后圆内闪示 Check/X，约 320ms 后由 Go 隐藏窗口。
            只在 idle 圆里出现，残留的 flash 不会漏进下一次录音。 */}
        <div className={styles.flash} aria-hidden="true">
          {flash === 'error' ? <X size={26} /> : <Check size={26} />}
        </div>
      </div>
    </main>
  );
}
