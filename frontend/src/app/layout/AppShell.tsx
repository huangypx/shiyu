import { useCallback } from 'react';
import { Outlet } from 'react-router-dom';

import AppSidebar from '@/app/layout/Sidebar';
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
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const closeSidebar = useUiStore((state) => state.closeSidebar);
  const settingsOpen = useUiStore((state) => state.settingsOpen);
  const closeSettings = useUiStore((state) => state.closeSettings);
  const appearance = useUiStore((state) => state.appearance);
  const setAppearance = useUiStore((state) => state.setAppearance);

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
      {/* 窗口标题只有一条 36px 顶带：侧栏头部与 TopBar 并排拼成它，
          Windows/Linux 的窗口按钮落在 TopBar 右端。 */}
      <div className={styles.body}>
        <AppSidebar />
        <main className={styles.main}>
          <TopBar />
          <div className={styles.scroll}>
            <Outlet />
          </div>
        </main>
      </div>

      {sidebarOpen && (
        <button
          type="button"
          className={styles.scrim}
          aria-label="关闭菜单"
          onClick={closeSidebar}
        />
      )}

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
          appearance={appearance}
          onAppearanceChange={setAppearance}
        />
      )}
    </div>
  );
}
