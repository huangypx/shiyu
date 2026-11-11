import BubbleWindow from '@/features/desktop/BubbleWindow';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

// 浮动模式不走路由：窗口顶部是录音球，悬停时在下方显示三个操作。
// 右键只保留隐藏悬浮球和退出拾语。
export default function BubbleRoute() {
  const status = useSessionStore((state) => state.status);
  const flash = useUiStore((state) => state.bubbleFlash);
  const { toggleRecording, cancelTranscription } = useRecordingActions();
  const { expandWindow, openSettingsWindow } = useWindowActions();

  return (
    <BubbleWindow
      isArming={status === 'arming'}
      isRecording={status === 'recording'}
      isProcessing={status === 'processing'}
      flash={flash}
      onToggle={toggleRecording}
      onExpand={expandWindow}
      onCancel={cancelTranscription}
      onOpenSettings={openSettingsWindow}
    />
  );
}
