import { Archive, SunMedium } from 'lucide-react';

import RecordingCard from '@/features/recorder/RecordingCard';
import {
  useProcessingTimer,
  useRecordingSession,
} from '@/features/recorder/useRecordingSession';
import EditorCard from '@/features/transcript/EditorCard';
import { formatDate, getGreeting } from '@/lib/format';
import { useUiStore } from '@/store/uiStore';

import styles from './RecordPage.module.css';

export default function RecordPage() {
  const session = useRecordingSession();
  const openSettings = useUiStore((state) => state.openSettings);
  useProcessingTimer(session.isProcessing);

  return (
    <div className={styles.workspace}>
      <section className={styles.welcome}>
        <div>
          <p className={styles.eyebrow}>
            <SunMedium size={13} /> {getGreeting()}
          </p>
          <h1>今天想记录什么？</h1>
          <p className={styles.subtitle}>
            按下录音，说出你的想法。拾语会帮你整理成清晰的文字。
          </p>
        </div>
        <span className={styles.date}>{formatDate()}</span>
      </section>

      <RecordingCard
        isArming={session.isArming}
        isRecording={session.isRecording}
        isProcessing={session.isProcessing}
        stage={session.stage}
        elapsedMs={session.elapsedMs}
        language={session.language}
        onToggle={session.toggleRecording}
        onCancel={session.cancelTranscription}
        onSettings={openSettings}
      />

      <EditorCard
        status={session.status}
        transcript={session.transcript}
        organized={session.organized}
        isProcessing={session.isProcessing}
        isOrganizing={session.isOrganizing}
        copied={session.copied}
        metrics={session.metrics}
        presets={session.presets}
        activePresetId={session.activePresetId}
        onSelectPreset={session.selectPreset}
        onTranscriptChange={session.setTranscript}
        onClear={session.clearDraft}
        onOrganize={session.runOrganize}
        onCopy={session.copyResult}
      />

      <p className={styles.privacy}>
        <Archive size={12} /> 内容保存在本机，你的数据属于你
      </p>
    </div>
  );
}
