import BubbleWindow from '@/features/desktop/BubbleWindow';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

export default function BubbleRoute() {
  const status = useSessionStore((state) => state.status);
  const result = useSessionStore((state) => state.bubbleResult);
  const copied = useSessionStore((state) => state.copied);
  const notice = useUiStore((state) => state.notice);
  const { toggleRecording, copyResult } = useRecordingActions();
  const { expandWindow } = useWindowActions();

  return (
    <BubbleWindow
      isArming={status === 'arming'}
      isRecording={status === 'recording'}
      isProcessing={status === 'processing'}
      result={result}
      copied={copied}
      notice={notice}
      onCopy={copyResult}
      onToggle={toggleRecording}
      onExpand={expandWindow}
    />
  );
}
