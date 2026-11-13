import { Button, Dialog, Flex, Tabs, Text } from '@radix-ui/themes';
import { ShieldCheck } from 'lucide-react';

import type {
  DesktopSettings,
  DesktopState,
  ModelSettings,
} from '@/types/models';

import AppearanceSection from './sections/AppearanceSection';
import AsrSection from './sections/AsrSection';
import DesktopSection from './sections/DesktopSection';
import LlmSection from './sections/LlmSection';
import PresetSection from './sections/PresetSection';
import styles from './SettingsDialog.module.css';

type Props = {
  settings: ModelSettings;
  onChange: (patch: Partial<ModelSettings>) => void;
  onClose: () => void;
  onSave: () => void;
  desktop: DesktopSettings;
  desktopState?: DesktopState;
  onDesktopChange: (patch: Partial<DesktopSettings>) => void;
};

// 设置弹窗不进路由：浮动球的设置图标与全局快捷键都可能
// 在任意页面打开它，路由切换会卸载正在编辑的表单。
export default function SettingsDialog({
  settings,
  onChange,
  onClose,
  onSave,
  desktop,
  desktopState,
  onDesktopChange,
}: Props) {
  return (
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Content maxWidth="640px">
        <Dialog.Title>偏好设置</Dialog.Title>
        <Dialog.Description size="1" color="gray">
          选择语音识别和文字整理服务，密钥只保存在 ~/.shiyu/config.json。
        </Dialog.Description>

        <Tabs.Root defaultValue="asr">
          <Tabs.List>
            <Tabs.Trigger value="asr">语音识别</Tabs.Trigger>
            <Tabs.Trigger value="llm">文字整理</Tabs.Trigger>
            <Tabs.Trigger value="presets">整理预设</Tabs.Trigger>
            <Tabs.Trigger value="desktop">桌面行为</Tabs.Trigger>
            <Tabs.Trigger value="appearance">外观</Tabs.Trigger>
          </Tabs.List>

          <Tabs.Content value="asr">
            <AsrSection settings={settings} onChange={onChange} />
          </Tabs.Content>
          <Tabs.Content value="llm">
            <LlmSection settings={settings} onChange={onChange} />
          </Tabs.Content>
          <Tabs.Content value="presets">
            <PresetSection settings={settings} onChange={onChange} />
          </Tabs.Content>
          <Tabs.Content value="desktop">
            <DesktopSection
              desktop={desktop}
              desktopState={desktopState}
              onDesktopChange={onDesktopChange}
            />
          </Tabs.Content>
          <Tabs.Content value="appearance">
            <AppearanceSection />
          </Tabs.Content>
        </Tabs.Root>

        <Flex justify="between" align="center" mt="4" gap="3">
          <Text size="1" color="gray" className={styles.footerNote}>
            <ShieldCheck size={13} /> 配置仅存储在本机
          </Text>
          <Flex gap="2">
            <Button variant="soft" color="gray" onClick={onClose}>
              取消
            </Button>
            <Button color="gray" highContrast onClick={onSave}>
              保存设置
            </Button>
          </Flex>
        </Flex>
      </Dialog.Content>
    </Dialog.Root>
  );
}
