import OverlayWindow from '@/features/desktop/OverlayWindow';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

// 底部胶囊不走路由：录音由全局热键驱动（见 App.tsx 的 useGlobalHotkey），
// 胶囊本身只暴露取消。反馈用圆内闪示而非 Toast——窗口马上消失。
export default function OverlayRoute() {
  const status = useSessionStore((state) => state.status);
  const flash = useUiStore((state) => state.overlayFlash);
  const { cancelTranscription } = useRecordingActions();

  return (
    <OverlayWindow
      isArming={status === 'arming'}
      isRecording={status === 'recording'}
      isProcessing={status === 'processing'}
      flash={flash}
      onCancel={cancelTranscription}
    />
  );
}
