import { SegmentedControl } from '@radix-ui/themes';
import { Check } from 'lucide-react';
import { useId } from 'react';

import { paletteById, PALETTES } from '@/lib/palettes';
import { type Appearance, useUiStore } from '@/store/uiStore';

import styles from './AppearanceSection.module.css';

// 主题色只影响界面，不进 ~/.shiyu/config.json：切换后立即生效，
// 持久化交给 uiStore 写 localStorage。
export default function AppearanceSection() {
  const palette = useUiStore((state) => state.palette);
  const appearance = useUiStore((state) => state.appearance);
  const setPalette = useUiStore((state) => state.setPalette);
  const setAppearance = useUiStore((state) => state.setAppearance);
  // 原生 radio 靠同一个 name 组成一组；useId 避免同一页面出现重名。
  const group = useId();
  const spec = paletteById(palette);

  return (
    <div className={styles.section}>
      <fieldset className={styles.field}>
        <legend className={styles.legend}>主题色</legend>
        <div className={styles.options}>
          {PALETTES.map((item) => (
            <label className={styles.option} key={item.id}>
              <input
                type="radio"
                name={group}
                value={item.id}
                checked={palette === item.id}
                onChange={() => setPalette(item.id)}
              />
              <span className={styles.card}>
                <span
                  className={styles.swatch}
                  data-swatch={item.id}
                  aria-hidden="true"
                />
                <span className={styles.caption}>
                  {item.label}
                  {palette === item.id && (
                    <Check size={13} aria-hidden="true" />
                  )}
                </span>
              </span>
            </label>
          ))}
        </div>
        <p className={styles.hint}>{spec.description}</p>
      </fieldset>

      <fieldset className={styles.field}>
        <legend className={styles.legend}>明暗模式</legend>
        {spec.appearance ? (
          <p className={styles.hint}>
            这套主题固定为{spec.appearance === 'light' ? '浅色' : '深色'}。
            明暗偏好会在切回经典黑白时恢复。
          </p>
        ) : (
          <SegmentedControl.Root
            aria-label="明暗模式"
            value={appearance}
            onValueChange={(value) => setAppearance(value as Appearance)}
          >
            <SegmentedControl.Item value="system">
              跟随系统
            </SegmentedControl.Item>
            <SegmentedControl.Item value="light">浅色</SegmentedControl.Item>
            <SegmentedControl.Item value="dark">深色</SegmentedControl.Item>
          </SegmentedControl.Root>
        )}
      </fieldset>
    </div>
  );
}
