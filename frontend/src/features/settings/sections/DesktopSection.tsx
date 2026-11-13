import { SegmentedControl, Select, TextField } from '@radix-ui/themes';

import { setBubbleHidden } from '@/services/bridge';
import { detectPlatform } from '@/services/platform';
import type { Appearance } from '@/store/uiStore';
import {
  defaultHotkeyFor,
  type DesktopSettings,
  type DesktopState,
} from '@/types/models';

import styles from '../SettingsDialog.module.css';
import ToggleRow from './ToggleRow';

type Props = {
  desktop: DesktopSettings;
  desktopState?: DesktopState;
  onDesktopChange: (patch: Partial<DesktopSettings>) => void;
  appearance: Appearance;
  onAppearanceChange: (appearance: Appearance) => void;
};

export default function DesktopSection({
  desktop,
  desktopState,
  onDesktopChange,
  appearance,
  onAppearanceChange,
}: Props) {
  const hotkeyHint =
    desktopState?.hotkeyRegistered && desktopState.canInjectText
      ? '快捷键已注册，应用在后台也可以开始录音。'
      : desktopState?.hotkeyRegistered && !desktopState.canInjectText
        ? '快捷键已注册；未找到系统粘贴工具，结果仍会复制到剪贴板。'
        : desktopState?.hotkeyReason ||
          '桌面端会优先注册全局快捷键，浏览器预览使用窗口内快捷键。';
  const platform = desktopState?.platform ?? detectPlatform();
  const hotkeyPlaceholder = defaultHotkeyFor(platform);
  // 只有 macOS/Windows 有系统托盘；隐藏悬浮球后靠它恢复，无托盘的
  // 平台禁用开关，否则隐藏后没有任何入口能再叫出界面。
  const traySupported = platform === 'darwin' || platform === 'windows';

  return (
    <div className={styles.form}>
      <div className={styles.field}>
        <span className={styles.label}>全局快捷键</span>
        <TextField.Root
          value={desktop.hotkey}
          onChange={(event) => onDesktopChange({ hotkey: event.target.value })}
          placeholder={hotkeyPlaceholder}
          aria-label="全局快捷键"
          aria-describedby="hotkey-help"
        />
      </div>
      <p className={styles.hint} id="hotkey-help">
        {hotkeyHint}
      </p>

      <ToggleRow
        title="整理完成后自动粘贴"
        description="把结果输入到触发录音前的当前光标位置"
        checked={desktop.autoPaste}
        onCheckedChange={(checked) => onDesktopChange({ autoPaste: checked })}
      />
      <ToggleRow
        title="启动时显示浮动圆圈"
        description="主窗口仍可从圆圈展开"
        checked={desktop.startInBubble}
        onCheckedChange={(checked) =>
          onDesktopChange({ startInBubble: checked })
        }
      />
      <ToggleRow
        title="浮动圆圈保持置顶"
        description="适合在编辑器、浏览器和聊天软件之间切换"
        checked={desktop.keepBubbleOnTop}
        onCheckedChange={(checked) =>
          onDesktopChange({ keepBubbleOnTop: checked })
        }
      />
      <ToggleRow
        title="隐藏悬浮球（仅保留托盘）"
        description={
          traySupported
            ? '隐藏后只剩托盘图标，按全局快捷键开始录音'
            : '当前平台没有系统托盘，隐藏后将无法恢复界面'
        }
        checked={desktopState?.bubbleHidden ?? false}
        onCheckedChange={(checked) => {
          void setBubbleHidden(checked)?.catch(() => undefined);
        }}
        disabled={!traySupported}
      />
      <ToggleRow
        title="粘贴后恢复原剪贴板"
        description="约 1.5 秒后恢复，避免覆盖你原来的内容"
        checked={desktop.restoreClipboard}
        onCheckedChange={(checked) =>
          onDesktopChange({ restoreClipboard: checked })
        }
      />
      <ToggleRow
        title="保留主窗口结果预览"
        description="关闭后仍会保存历史并自动粘贴，但不展开结果面板"
        checked={desktop.showResultPreview}
        onCheckedChange={(checked) =>
          onDesktopChange({ showResultPreview: checked })
        }
      />

      <div className={styles.field}>
        <span className={styles.label}>外观</span>
        <SegmentedControl.Root
          value={appearance}
          onValueChange={(value) => onAppearanceChange(value as Appearance)}
        >
          <SegmentedControl.Item value="system">跟随系统</SegmentedControl.Item>
          <SegmentedControl.Item value="light">浅色</SegmentedControl.Item>
          <SegmentedControl.Item value="dark">深色</SegmentedControl.Item>
        </SegmentedControl.Root>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>历史保留期</span>
        <Select.Root
          value={String(desktop.historyRetentionDays)}
          onValueChange={(value) =>
            onDesktopChange({ historyRetentionDays: Number(value) })
          }
        >
          <Select.Trigger aria-label="历史保留期" />
          <Select.Content>
            <Select.Item value="0">永久保留</Select.Item>
            <Select.Item value="365">一年</Select.Item>
            <Select.Item value="90">90 天</Select.Item>
            <Select.Item value="30">30 天</Select.Item>
            <Select.Item value="7">7 天</Select.Item>
          </Select.Content>
        </Select.Root>
        <p className={styles.hint}>
          历史存放在本机的 SQLite 数据库里，超出保留期的记录会在启动时清理。
        </p>
      </div>
    </div>
  );
}
