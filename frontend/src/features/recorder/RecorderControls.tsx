import { LoaderCircle, Mic, Pause } from 'lucide-react';

import type { SessionStage } from '@/store/sessionStore';

import styles from './RecorderControls.module.css';

type Props = {
  // 开启麦克风与真正录音分开：采集确认之前不能显示录音态。
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  // 处理中的两段要分清楚：识别与整理等待的是不同的东西。
  stage: SessionStage;
  onToggle: () => void;
};

// 记录页栏头只放一枚圆形按钮：待录音是麦克风，录音中变红暂停，
// 处理中显示旋转图标。
// 波形、耗时与「录音中 / 转写中」这些状态说明不在这里重复：浮动窗
// （悬浮球或底部胶囊）始终在屏上，状态与取消都在那边，主窗口再说一遍
// 只会让栏头变吵。可访问名称仍逐态写清楚，读屏不会只听到一个图标。
export default function RecorderControls({
  isArming,
  isRecording,
  isProcessing,
  stage,
  onToggle,
}: Props) {
  const state = isProcessing
    ? 'processing'
    : isRecording
      ? 'recording'
      : isArming
        ? 'arming'
        : 'idle';
  const organizing = isProcessing && stage === 'organize';
  const label = isProcessing
    ? organizing
      ? '整理中'
      : '转写中'
    : isRecording
      ? '结束录音'
      : isArming
        ? '取消开启麦克风'
        : '开始录音';

  return (
    <button
      type="button"
      className={styles.record}
      data-state={state}
      onClick={onToggle}
      disabled={isProcessing}
      aria-label={label}
      title={label}
    >
      {isProcessing ? (
        <LoaderCircle className="spin" size={15} />
      ) : isRecording ? (
        <Pause size={14} fill="currentColor" />
      ) : (
        <Mic size={16} />
      )}
    </button>
  );
}
