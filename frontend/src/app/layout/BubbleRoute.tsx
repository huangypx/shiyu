import BubbleWindow from '@/features/desktop/BubbleWindow';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

// 浮动模式不走路由：整个窗口只有一个 92x92 的圆圈。
// 右键菜单由 Wails v3 的原生 context menu 提供。
export default function BubbleRoute() {
  const status = useSessionStore((state) => state.status);
  const flash = useUiStore((state) => state.bubbleFlash);
  const { toggleRecording } = useRecordingActions();
  const { expandWindow } = useWindowActions();

  return (
    <BubbleWindow
      isArming={status === 'arming'}
      isRecording={status === 'recording'}
      isProcessing={status === 'processing'}
      flash={flash}
      onToggle={toggleRecording}
      onExpand={expandWindow}
    />
  );
}
