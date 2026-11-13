import { useCallback, useEffect } from 'react';

import { useDesktopBridge } from '@/app/useDesktopBridge';
import { useSessionBridge } from '@/app/useSessionBridge';
import BubbleWindow from '@/features/desktop/BubbleWindow';
import { useGlobalHotkey } from '@/features/desktop/useGlobalHotkey';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useUiStore } from '@/store/uiStore';

// 悬浮球是独立窗口，只负责展示会话状态和发命令；麦克风在 overlay。
export default function BubbleApp() {
  useDesktopBridge();
  useSessionBridge();

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
  }, []);

  const session = useRecordingSession();
  const flash = useUiStore((state) => state.bubbleFlash);
  const { expandWindow, openSettingsWindow } = useWindowActions();
  const trigger = useCallback(() => {
    session.toggleRecording();
  }, [session]);
  useGlobalHotkey(trigger);

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
