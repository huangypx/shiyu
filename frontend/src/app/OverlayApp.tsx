import { useDesktopBridge } from '@/app/useDesktopBridge';
import { useDesktopNotices } from '@/app/useDesktopNotices';
import { useSessionBridge } from '@/app/useSessionBridge';
import OverlayWindow from '@/features/desktop/OverlayWindow';
import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import { useUiStore } from '@/store/uiStore';

// 底部胶囊只是 Go 会话的视图；麦克风和转写都在后端。
export default function OverlayApp() {
  useDesktopBridge();
  useSessionBridge();
  useDesktopNotices();

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
