import { useCallback, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import { router } from '@/app/router';
import { useDesktopBridge } from '@/app/useDesktopBridge';
import { useDesktopNotices } from '@/app/useDesktopNotices';
import { useMainWindowReady } from '@/app/useMainWindowReady';
import { useSessionBridge } from '@/app/useSessionBridge';
import { useCallsStore } from '@/features/calls/callsStore';
import CloseDialog from '@/features/desktop/CloseDialog';
import { useAppShortcuts } from '@/features/desktop/useAppShortcuts';
import { useGlobalHotkey } from '@/features/desktop/useGlobalHotkey';
import { useNotesStore } from '@/features/history/notesStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { takeMainCommands } from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

// 主窗口只是会话与桌面状态的一个视图；录音采集在 Go 内核。
export default function App() {
  const closeRequested = useDesktopStore(
    (state) => state.runtime.closeRequested,
  );
  const { toggleRecording } = useRecordingActions();

  useDesktopBridge();
  useSessionBridge();
  useDesktopNotices();
  useMainWindowReady();
  useAppShortcuts();
  const triggerRecording = useCallback(() => {
    toggleRecording();
  }, [toggleRecording]);
  useGlobalHotkey(triggerRecording);

  // 配置、历史与调用日志在窗口挂载时各拉一次，之后由操作驱动。
  // 历史必须在设置之后加载：迁移旧 localStorage 记录时要读当前模型配置。
  useEffect(() => {
    void useSettingsStore
      .getState()
      .hydrate()
      .then(() => useNotesStore.getState().hydrate());
    void useCallsStore.getState().hydrate();
  }, []);

  // 录音/整理在 Go 里完成并直接写历史；回到 idle 后刷新列表。
  useEffect(
    () =>
      useSessionStore.subscribe((state, previous) => {
        if (state.status !== 'idle' || previous.status === 'idle') return;
        void useNotesStore.getState().hydrate();
        void useCallsStore.getState().refresh();
      }),
    [],
  );

  // 从悬浮球打开偏好设置时，主窗口可能刚创建，事件会早于订阅。
  useEffect(() => {
    let cancelled = false;
    void takeMainCommands()
      .then((commands) => {
        if (!cancelled && commands.includes('settings')) {
          useUiStore.getState().openSettings();
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <>
      <RouterProvider router={router} />
      {closeRequested && <CloseDialog />}
    </>
  );
}
