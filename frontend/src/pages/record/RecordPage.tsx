import { useRecordingSession } from '@/features/recorder/useRecordingSession';
import Workspace from '@/features/transcript/Workspace';
import { useUiStore } from '@/store/uiStore';

import styles from './RecordPage.module.css';

// 页面只把会话状态接进双栏工作区，布局与文案都在 Workspace 里，
// 记录页因此没有自己的欢迎区，也不持有任何呈现状态。
export default function RecordPage() {
  const session = useRecordingSession();
  const recordSplit = useUiStore((state) => state.recordSplit);
  const setRecordSplit = useUiStore((state) => state.setRecordSplit);

  return (
    <div className={styles.page}>
      <Workspace
        status={session.status}
        stage={session.stage}
        transcript={session.transcript}
        organized={session.organized}
        copied={session.copied}
        presets={session.presets}
        activePresetId={session.activePresetId}
        asrModel={session.asrModel}
        llmModel={session.llmModel}
        asrModels={session.asrModels}
        llmModels={session.llmModels}
        language={session.language}
        split={recordSplit}
        onSplitChange={setRecordSplit}
        onToggleRecording={session.toggleRecording}
        onTranscriptChange={session.setTranscript}
        onOrganizedChange={session.setOrganized}
        onOrganize={session.runOrganize}
        onCopyTranscript={session.copyTranscript}
        onCopyResult={session.copyResult}
        onSelectPreset={session.selectPreset}
        onSelectAsrModel={session.selectAsrModel}
        onSelectLlmModel={session.selectLlmModel}
        onSelectLanguage={session.selectLanguage}
      />
    </div>
  );
}
