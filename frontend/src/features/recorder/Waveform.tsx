import type { CSSProperties } from 'react';

import styles from './Waveform.module.css';

// 每根竖条对音量的响应不同，中间更高，安静时仍可看清波形的位置。
const BAR_WEIGHTS = [
  0.4, 0.62, 0.85, 0.55, 0.75, 1, 0.7, 0.5, 0.8, 1, 0.62, 0.85, 0.5, 0.72, 0.95,
  0.6, 0.42,
];

export function Waveform({
  active,
  processing = false,
  arming = false,
  className = styles.waveform,
}: {
  active: boolean;
  processing?: boolean;
  arming?: boolean;
  className?: string;
}) {
  return (
    <span
      className={className}
      data-active={active || undefined}
      data-processing={processing || undefined}
      data-arming={arming || undefined}
      aria-hidden="true"
    >
      {BAR_WEIGHTS.map((weight, index) => (
        <i key={index} style={{ '--bar-weight': weight } as CSSProperties} />
      ))}
    </span>
  );
}
