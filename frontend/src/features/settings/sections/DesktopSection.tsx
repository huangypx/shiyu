import { Select, TextField } from '@radix-ui/themes';

import { captureHotkey } from '@/features/desktop/hotkey';
import {
  DEFAULT_DESKTOP_SETTINGS,
  type DesktopSettings,
  type DesktopState,
} from '@/types/models';

import styles from '../SettingsDialog.module.css';
import AppearanceSection from './AppearanceSection';
import ToggleRow from './ToggleRow';

type Props = {
  desktop: DesktopSettings;
  desktopState?: DesktopState;
  onDesktopChange: (patch: Partial<DesktopSettings>) => void;
};

export default function DesktopSection({
  desktop,
  desktopState,
  onDesktopChange,
}: Props) {
  const hotkeyHint =
    desktopState?.hotkeyReason ||
    '按一次开始录音，再按一次结束。点击输入框可录入新快捷键。';

  return (
    <div className={styles.form}>
      <AppearanceSection />
      <div className={styles.field}>
        <label htmlFor="recording-hotkey" className={styles.label}>
          开始 / 结束录音快捷键
        </label>
        <TextField.Root
          id="recording-hotkey"
          value={desktop.hotkey}
          onFocus={(event) => event.target.select()}
          onChange={(event) => onDesktopChange({ hotkey: event.target.value })}
          onKeyDown={(event) => {
            const hotkey = captureHotkey(event.nativeEvent);
            if (hotkey) {
              event.preventDefault();
              event.stopPropagation();
              onDesktopChange({ hotkey });
            }
          }}
          placeholder={DEFAULT_DESKTOP_SETTINGS.hotkey}
          aria-describedby="hotkey-help"
        />
      </div>
      <p className={styles.hint} id="hotkey-help">
        {hotkeyHint}
      </p>

      <div className={styles.field}>
        <span className={styles.label}>关闭窗口时</span>
        <Select.Root
          value={desktop.closeAction}
          onValueChange={(value) =>
            onDesktopChange({
              closeAction: value as DesktopSettings['closeAction'],
            })
          }
        >
          <Select.Trigger aria-label="关闭窗口时" />
          <Select.Content>
            <Select.Item value="ask">每次询问</Select.Item>
            <Select.Item value="background">后台运行</Select.Item>
            <Select.Item value="quit">直接退出</Select.Item>
          </Select.Content>
        </Select.Root>
      </div>

      <ToggleRow
        title="整理完成后自动粘贴"
        description="把结果输入到触发录音前的当前光标位置"
        checked={desktop.autoPaste}
        onCheckedChange={(checked) => onDesktopChange({ autoPaste: checked })}
      />
      <ToggleRow
        title="开机启动"
        description={
          desktopState?.platform === 'windows'
            ? '登录 Windows 后自动在后台运行'
            : '开机启动适用于 Windows 桌面端'
        }
        checked={desktop.launchAtLogin}
        disabled={desktopState?.platform !== 'windows'}
        onCheckedChange={(checked) =>
          onDesktopChange({ launchAtLogin: checked })
        }
      />
      <ToggleRow
        title="启动时在后台运行"
        description="点击系统托盘里的拾语图标可打开主窗口"
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
