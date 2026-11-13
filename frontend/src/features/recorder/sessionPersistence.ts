import { useNotesStore } from '@/features/history/notesStore';
import { useSettingsStore } from '@/features/settings/settingsStore';
import { pasteText } from '@/services/bridge';
import type { NoticeTone } from '@/store/uiStore';
import type { CallMetrics } from '@/types/models';

export type SessionFeedback = (message: string, tone?: NoticeTone) => void;

// 预设名按调用时的名字记下来：之后改名不该改写已有历史。
export function saveSessionNote(
  text: string,
  result: string,
  metrics?: CallMetrics,
) {
  const settings = useSettingsStore.getState().models;
  const presetName = settings.presets.find(
    (preset) => preset.id === settings.activePresetId,
  )?.name;
  // 桌面端的裁剪由 SQLite 的保留期负责，不传条数上限；
  // 浏览器预览仍用上限，避免 localStorage 无限增长。
  useNotesStore.getState().addNote({ text, result, metrics, presetName }, 0);
}

export async function deliverSessionResult(
  result: string,
  feedback: SessionFeedback,
) {
  const desktop = useSettingsStore.getState().desktop;
  if (!desktop.autoPaste) {
    feedback('已完成转写和整理');
    return;
  }
  try {
    const injected = await pasteText(result);
    feedback(
      injected ? '已整理并粘贴到当前光标' : '已整理，结果已复制到剪贴板',
    );
  } catch {
    feedback('已整理，自动粘贴失败，结果仍在剪贴板中');
  }
}
