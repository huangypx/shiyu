import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';

import TopBar from '@/app/layout/TopBar';
import { useFeedback } from '@/app/useFeedback';
import Toast from '@/components/ui/Toast';
import SettingsDialog from '@/features/settings/SettingsDialog';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import styles from './AppShell.module.css';

export default function AppShell() {
  const runtime = useDesktopStore((state) => state.runtime);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);

  const models = useSettingsStore((state) => state.models);
  const desktop = useSettingsStore((state) => state.desktop);
  const patchModels = useSettingsStore((state) => state.patchModels);
  const patchDesktop = useSettingsStore((state) => state.patchDesktop);
  const saveSettings = useSettingsStore((state) => state.save);
  const feedback = useFeedback();

  const handleSave = useCallback(async () => {
    const remoteSaved = await saveSettings();
    closeSettings();
    feedback(
      // 「本机」指代不清：失败时配置其实只写进了 localStorage，
      // 说清楚落点是哪里，用户才知道该不该重试。
      remoteSaved
        ? '设置已保存到 ~/.shiyu/config.json'
        : '已保存在浏览器本地，桌面配置暂未写入',
      remoteSaved ? 'success' : 'error',
    );
  }, [closeSettings, feedback, saveSettings]);

  return (
    <div className={styles.shell}>
      {/* 窗口标题只有一条 36px 顶带：品牌、导航和窗口按钮都排在这一行。 */}
      <TopBar />
      <main className={styles.scroll}>
        <Outlet />
      </main>

      <Toast />

      {settingsOpen && (
        <SettingsDialog
          settings={models}
          desktop={desktop}
          desktopState={runtime}
          onChange={patchModels}
          onDesktopChange={patchDesktop}
          onClose={closeSettings}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
