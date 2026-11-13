import { useEffect } from 'react';

import { useDesktopBridge } from '@/app/useDesktopBridge';
import { useSessionBridge } from '@/app/useSessionBridge';
import OverlayWindow from '@/features/desktop/OverlayWindow';
import { useRecorderHost } from '@/features/recorder/useRecorderHost';
import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { useUiStore } from '@/store/uiStore';

// 底部胶囊是唯一采集宿主：它运行麦克风与转写流水线，同时把
// 会话状态写回 Go，供 main/bubble 两个视图渲染。
export default function OverlayApp() {
  useDesktopBridge();
  useSessionBridge();
  useRecorderHost();

  useEffect(() => {
    void useSettingsStore.getState().hydrate();
  }, []);

  const session = useRecordingSession();
  const flash = useUiStore((state) => state.overlayFlash);

  return (
    <OverlayWindow
      isArming={session.isArming}
      isRecording={session.isRecording}
      isProcessing={session.isProcessing}
      flash={flash}
      onCancel={session.cancelTranscription}
    />
  );
}
