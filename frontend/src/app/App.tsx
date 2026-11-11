import { useCallback, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import BubbleRoute from '@/app/layout/BubbleRoute';
import { router } from '@/app/router';
import { useCallsStore } from '@/features/calls/callsStore';
import { useAppShortcuts } from '@/features/desktop/useAppShortcuts';
import { useDesktopBridge } from '@/features/desktop/useDesktopBridge';
import { useGlobalHotkey } from '@/features/desktop/useGlobalHotkey';
import WindowTransition from '@/features/desktop/WindowTransition';
import { useNotesStore } from '@/features/history/notesStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useDesktopStore } from '@/store/desktopStore';

export default function App() {
  const mode = useDesktopStore((state) => state.runtime.mode);
  const { toggleRecording } = useRecordingActions();

  useDesktopBridge();
  useAppShortcuts();
  // 快捷键与界面无关：浮动模式下同样要能开始录音。
  const triggerRecording = useCallback(() => {
    void toggleRecording();
  }, [toggleRecording]);
  useGlobalHotkey(triggerRecording);

  // 配置、历史与调用日志在启动时各拉一次，之后由操作驱动。
  // 历史必须在设置之后加载：迁移旧 localStorage 记录时要读当前模型配置。
  useEffect(() => {
    void useSettingsStore
      .getState()
      .hydrate()
      .then(() => useNotesStore.getState().hydrate());
    void useCallsStore.getState().hydrate();
  }, []);

  return (
    <>
      {mode === 'bubble' ? <BubbleRoute /> : <RouterProvider router={router} />}
      <WindowTransition />
    </>
  );
}
