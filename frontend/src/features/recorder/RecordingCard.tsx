import { Badge, Button, IconButton, Tooltip } from '@radix-ui/themes';
import { LoaderCircle, Mic, RotateCcw, Settings, Square } from 'lucide-react';
import { type CSSProperties, useRef } from 'react';

import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import type { SessionStage } from '@/store/sessionStore';

import styles from './RecordingCard.module.css';

type Props = {
  // 开启麦克风与真正录音分开：采集确认之前不能显示录音态。
  isArming: boolean;
  isRecording: boolean;
  isProcessing: boolean;
  // 处理中的两段要说不同的话：识别与整理等待的是不同的东西。
  stage: SessionStage;
  // 等待服务商的毫秒数，处理中显示：慢调用要看起来是慢，
  // 而不是看起来卡住。
  elapsedMs: number;
  language: string;
  onToggle: () => void;
  // 取消这段转写：录音中丢弃已采集的音频，处理中中断在途请求。
  onCancel: () => void;
  onSettings: () => void;
};

// 每根竖条响应音量的程度不同，中间高、两侧低，
// 才像一支对着说话人的电平条。
const BAR_WEIGHTS = [
  0.4, 0.62, 0.85, 0.55, 0.75, 1, 0.7, 0.5, 0.8, 1, 0.62, 0.85, 0.5, 0.72, 0.95,
  0.6, 0.42,
];

export default function RecordingCard({
  isArming,
  isRecording,
  isProcessing,
  stage,
  elapsedMs,
  language,
  onToggle,
  onCancel,
  onSettings,
}: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  useMicLevelVar(stageRef);

  const state = isProcessing
    ? 'processing'
    : isRecording
      ? 'recording'
      : isArming
        ? 'arming'
        : 'idle';
  const organizing = isProcessing && stage === 'organize';

  return (
    <section className={styles.card} data-state={state} aria-live="polite">
      <div className={styles.copy}>
        <span className={styles.label}>
          {isProcessing
            ? organizing
              ? '整理中'
              : '转写中'
            : isRecording
              ? '正在聆听'
              : isArming
                ? '开启麦克风'
                : '准备好了吗'}
        </span>
        <strong>
          {isProcessing
            ? organizing
              ? '正在把原文整理得更清楚'
              : '正在把你的语音变成文字'
            : isRecording
              ? '自由地说，不必斟酌措辞'
              : isArming
                ? '授权麦克风后就能直接开口'
                : '点击下方按钮开始说话'}
        </strong>
        <small>
          {isProcessing
            ? organizing
              ? '整理完成后会自动翻到整理结果'
              : '识别结果会先显示在原始记录里'
            : isRecording
              ? '再次点击结束录音'
              : isArming
                ? '正在申请麦克风权限，再点一次可以取消'
                : '支持普通话、英语及更多语言'}
        </small>
        {(isRecording || isProcessing) && (
          <Button
            size="1"
            variant="ghost"
            color="gray"
            className={styles.cancel}
            onClick={onCancel}
          >
            <RotateCcw size={12} /> 取消这段转写
          </Button>
        )}
      </div>

      <div className={styles.stage} ref={stageRef}>
        <Waveform
          active={isRecording}
          processing={isProcessing}
          arming={isArming}
        />
        <button
          type="button"
          className={styles.recordButton}
          onClick={onToggle}
          disabled={isProcessing}
          aria-label={
            isRecording ? '结束录音' : isArming ? '取消开启麦克风' : '开始录音'
          }
        >
          {isProcessing ? (
            <LoaderCircle className="spin" size={22} />
          ) : isRecording ? (
            <Square size={18} fill="currentColor" />
          ) : (
            <Mic size={22} />
          )}
        </button>
        <span className={styles.hint}>
          {isProcessing
            ? '已用 ' + (elapsedMs / 1000).toFixed(1) + 's'
            : isRecording
              ? '结束录音'
              : isArming
                ? '开启中…'
                : '开始录音'}
        </span>
      </div>

      <div className={styles.meta}>
        <Badge size="1" variant="soft" color="gray">
          {language.split('（')[0]}
        </Badge>
        <Tooltip content="录音设置">
          <IconButton
            variant="ghost"
            color="gray"
            size="2"
            aria-label="录音设置"
            onClick={onSettings}
          >
            <Settings size={15} />
          </IconButton>
        </Tooltip>
      </div>
    </section>
  );
}

function Waveform({
  active,
  processing,
  arming,
}: {
  active: boolean;
  processing: boolean;
  arming: boolean;
}) {
  return (
    <div
      className={styles.waveform}
      data-active={active || undefined}
      data-processing={processing || undefined}
      data-arming={arming || undefined}
      aria-hidden="true"
    >
      {BAR_WEIGHTS.map((weight, index) => (
        <i key={index} style={{ '--bar-weight': weight } as CSSProperties} />
      ))}
    </div>
  );
}
