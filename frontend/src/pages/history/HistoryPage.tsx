import { useNavigate } from 'react-router-dom';

import { useFeedback } from '@/app/useFeedback';
import HistoryView from '@/features/history/HistoryView';
import { useNotesStore } from '@/features/history/notesStore';
import { copyText, pasteText } from '@/services/bridge';
import { useSessionStore } from '@/store/sessionStore';

export default function HistoryPage() {
  const navigate = useNavigate();
  const notes = useNotesStore((state) => state.notes);
  const hasOlder = useNotesStore((state) => state.olderAfter !== null);
  const loadingOlder = useNotesStore((state) => state.loadingOlder);
  const loadOlder = useNotesStore((state) => state.loadOlder);
  const removeNote = useNotesStore((state) => state.removeNote);
  const clearNotes = useNotesStore((state) => state.clearNotes);
  const setTranscript = useSessionStore((state) => state.setTranscript);
  const setOrganized = useSessionStore((state) => state.setOrganized);
  const setMetrics = useSessionStore((state) => state.setMetrics);
  const feedback = useFeedback();

  return (
    <HistoryView
      notes={notes}
      hasOlder={hasOlder}
      loadingOlder={loadingOlder}
      onLoadOlder={() => {
        void loadOlder().catch(() => feedback('读取历史记录失败', 'error'));
      }}
      onOpen={(note) => {
        void navigate('/');
        setTranscript(note.transcript || note.preview);
        setOrganized(note.organized || '');
        setMetrics(note.metrics ?? {});
      }}
      onCopy={async (text) => {
        await copyText(text);
        feedback('已复制历史结果');
      }}
      onPaste={async (text) => {
        try {
          const injected = await pasteText(text);
          feedback(injected ? '已粘贴历史结果' : '历史结果已复制到剪贴板');
        } catch {
          feedback('已复制历史结果，可手动粘贴');
        }
      }}
      onDelete={(id) => {
        void removeNote(id);
        feedback('记录已删除');
      }}
      onClear={() => {
        void clearNotes();
        feedback('历史已清空');
      }}
    />
  );
}
