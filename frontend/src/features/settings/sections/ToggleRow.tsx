import { Switch } from '@radix-ui/themes';

import styles from '../SettingsDialog.module.css';

type Props = {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  // 某些能力和接口类型绑定，不适用时置灰并靠 description 说明原因。
  disabled?: boolean;
};

// 「标题 + 说明 + 开关」在设置页里反复出现，抽出来保证两个
// section 的排版一致。
export default function ToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  disabled,
}: Props) {
  return (
    <div className={styles.toggle}>
      <span className={styles.toggleText}>
        <strong>{title}</strong>
        <small>{description}</small>
      </span>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-label={title}
      />
    </div>
  );
}
