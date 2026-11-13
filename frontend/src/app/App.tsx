import { useCallback, useEffect } from 'react';
import { RouterProvider } from 'react-router-dom';

import BubbleRoute from '@/app/layout/BubbleRoute';
import { router } from '@/app/router';
import { useCallsStore } from '@/features/calls/callsStore';
import CloseDialog from '@/features/desktop/CloseDialog';
import { useBubbleActivity } from '@/features/desktop/useBubbleActivity';
import { useDesktopBridge } from '@/features/desktop/useDesktopBridge';
import { useGlobalHotkey } from '@/features/desktop/useGlobalHotkey';
import WindowTransition from '@/features/desktop/WindowTransition';
import { useNotesStore } from '@/features/history/notesStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import {
  setTranscribing,
  subscribeDesktopCancelTranscription,
} from '@/services/bridge';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';

export default function App() {
  const mode = useDesktopStore((state) => state.runtime.mode);
  const closeRequested = useDesktopStore(
    (state) => state.runtime.closeRequested,
  );
  const status = useSessionStore((state) => state.status);
  const { toggleRecording, cancelTranscription } = useRecordingActions();

  useDesktopBridge();
  const bubbleVisible = useBubbleActivity();
  // 快捷键与界面无关：浮动模式下同样要能开始录音。
  const triggerRecording = useCallback(
    (target?: string) => {
      void toggleRecording(target);
    },
    [toggleRecording],
  );
  useGlobalHotkey(triggerRecording);

  // 浮动球右键菜单的「取消这段转写」在 Go 侧触发，这里接住它。
  useEffect(
    () => subscribeDesktopCancelTranscription(cancelTranscription),
    [cancelTranscription],
  );

  // 菜单项的可用性跟着录音状态走：没有可取消的内容时置灰。
  useEffect(() => {
    void setTranscribing(status !== 'idle')?.catch(() => undefined);
  }, [status]);

  // 配置、历史与调用日志在启动时各拉一次，之后由操作驱动。
  // 历史必须在设置之后加载：迁移旧 localStorage 记录时要读当前模型配置。
  useEffect(() => {
    void useSettingsStore
      .getState()
      .hydrate()
      .then(() => useNotesStore.getState().hydrate());
    void useCallsStore.getState().hydrate();
  }, []);

  if (mode === 'bubble') return bubbleVisible ? <BubbleRoute /> : null;
  return (
    <>
      <RouterProvider router={router} />
      <WindowTransition />
      {closeRequested && <CloseDialog />}
    </>
  );
}
