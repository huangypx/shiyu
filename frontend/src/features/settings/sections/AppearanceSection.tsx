import { SegmentedControl } from '@radix-ui/themes';
import { Check } from 'lucide-react';
import { useId } from 'react';

import { type Appearance, useUiStore } from '@/store/uiStore';

import styles from './AppearanceSection.module.css';

const palettes = [
  { id: 'celadon', label: '青瓷绿 × 朱红' },
  { id: 'mono', label: '经典黑白' },
  { id: 'plum', label: '深梅紫 × 杏桃' },
] as const;

export default function AppearanceSection() {
  const palette = useUiStore((state) => state.palette);
  const appearance = useUiStore((state) => state.appearance);
  const setPalette = useUiStore((state) => state.setPalette);
  const setAppearance = useUiStore((state) => state.setAppearance);
  const group = useId();

  return (
    <fieldset className={styles.section}>
      <legend>外观配色</legend>
      <div className={styles.options}>
        {palettes.map(({ id, label }) => (
          <label className={styles.option} key={id}>
            <input
              type="radio"
              name={group}
              value={id}
              checked={palette === id}
              onChange={() => setPalette(id)}
            />
            <span className={styles.card}>
              <span
                className={styles.swatch}
                data-swatch={id}
                aria-hidden="true"
              />
              <span className={styles.caption}>
                {label}
                {palette === id && <Check size={13} aria-hidden="true" />}
              </span>
            </span>
          </label>
        ))}
      </div>
      {palette === 'mono' && (
        <SegmentedControl.Root
          aria-label="经典黑白明暗模式"
          value={appearance}
          onValueChange={(value) => setAppearance(value as Appearance)}
        >
          <SegmentedControl.Item value="system">跟随系统</SegmentedControl.Item>
          <SegmentedControl.Item value="light">浅色</SegmentedControl.Item>
          <SegmentedControl.Item value="dark">深色</SegmentedControl.Item>
        </SegmentedControl.Root>
      )}
    </fieldset>
  );
}
