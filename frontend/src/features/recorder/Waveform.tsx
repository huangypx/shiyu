import { type CSSProperties } from 'react';

import styles from './Waveform.module.css';

// 每根竖条响应音量的程度不同，中间高、两侧低，
// 才像一支对着说话人的电平条。
const BAR_WEIGHTS = [
  0.4, 0.62, 0.85, 0.55, 0.75, 1, 0.7, 0.5, 0.8, 1, 0.62, 0.85, 0.5, 0.72, 0.95,
  0.6, 0.42,
];

type Props = {
  active: boolean;
  processing: boolean;
  arming: boolean;
  // 底部胶囊把同一排竖条拉开铺满整条宽度；浮窗小尺寸不传，保持紧凑居中。
  stretch?: boolean;
};

// 录音电平条：主窗口录音控件与底部胶囊共用同一套竖条。音量由外层
// 写入的 --mic-level 驱动，组件本身不订阅音量，避免两处重复采样。
export default function Waveform({
  active,
  processing,
  arming,
  stretch = false,
}: Props) {
  const className = [styles.waveform];
  if (stretch) className.push(styles.stretch);

  return (
    <div
      className={className.join(' ')}
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
