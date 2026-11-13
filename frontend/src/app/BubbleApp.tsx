import { useEffect } from 'react';

import { useDesktopBridge } from '@/app/useDesktopBridge';
import { useDesktopNotices } from '@/app/useDesktopNotices';
import { useSessionBridge } from '@/app/useSessionBridge';
import BubbleWindow from '@/features/desktop/BubbleWindow';
import { useGlobalHotkey } from '@/features/desktop/useGlobalHotkey';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useUiStore } from '@/store/uiStore';

// 悬浮球是独立窗口，只负责展示 Go 的会话状态和发命令。
export default function BubbleApp() {
  useDesktopBridge();
  useSessionBridge();
  useDesktopNotices();

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
  }, []);

  const session = useRecordingSession();
  const flash = useUiStore((state) => state.bubbleFlash);
  const { expandWindow, openSettingsWindow } = useWindowActions();
  useGlobalHotkey(session.toggleRecording);

  return (
    <BubbleWindow
      isArming={session.isArming}
      isRecording={session.isRecording}
      isProcessing={session.isProcessing}
      flash={flash}
      onToggle={session.toggleRecording}
      onExpand={expandWindow}
      onCancel={session.cancelTranscription}
      onOpenSettings={openSettingsWindow}
    />
  );
}
