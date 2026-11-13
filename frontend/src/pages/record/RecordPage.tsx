import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import EditorCard from '@/features/transcript/EditorCard';

import styles from './RecordPage.module.css';

export default function RecordPage() {
  const session = useRecordingSession();
  return (
    <div className={styles.workspace}>
      <EditorCard
        transcript={session.transcript}
        organized={session.organized}
        busy={session.status !== 'idle'}
        copied={session.copied}
        presets={session.presets}
        activePresetId={session.activePresetId}
        onSelectPreset={session.selectPreset}
        onTranscriptChange={session.setTranscript}
        onClear={session.clearDraft}
        onOrganize={session.runOrganize}
        onCopy={session.copyResult}
      />
    </div>
  );
}
