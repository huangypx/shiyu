import { create } from 'zustand';

import { useSettingsStore } from '@/features/settings/settingsStore';
import {
  clearHistory,
  deleteHistory,
  importHistory,
  loadHistory,
  saveHistory,
} from '@/services/bridge';
import {
  NOTES_KEY,
  readStoredList,
  removeStored,
  writeStored,
} from '@/services/storage';
import type { Note } from '@/types/models';

type AddNoteInput = {
  text: string;
  result: string;
  metrics?: Note['metrics'];
  presetName?: string;
};

type NotesState = {
  notes: Note[];
  // hydrated 区分「还没加载」与「确实没有历史」：
  // 前者不该渲染空状态文案。
  hydrated: boolean;
  hydrate: () => Promise<void>;
  // limit 是保留条数上限；0 表示不裁剪（桌面端由保留期负责）。
  addNote: (input: AddNoteInput, limit?: number) => void;
  removeNote: (id: string) => Promise<void>;
  clearNotes: () => Promise<void>;
};

// deriveTitle 取整理结果里的第一个标题，与后端 deriveHistoryTitle
// 保持同一规则；两边都算一次是为了让浏览器预览也能得到可读标题。
function deriveTitle(result: string) {
  const match = result.match(/^##?\s*(.+)$/m);
  return match?.[1]?.trim() || '未命名记录';
}

// limitNotes 只保留最近的若干条。桌面端的裁剪由 SQLite 的保留期
// 负责，这里主要服务浏览器预览，避免 localStorage 无限增长。
function limitNotes(notes: Note[], limit: number) {
  if (!limit || limit < 1) return notes;
  return notes.slice(0, limit);
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  hydrated: false,
  // 启动时从 SQLite 拉一次；浏览器预览没有后端，退回本地副本。
  hydrate: async () => {
    const remote = await loadHistory().catch(() => undefined);
    if (remote) {
      set({ notes: remote, hydrated: true });
      // 桌面端已经以 SQLite 为准，本地旧副本只在首次迁移时用得到。
      await migrateLocalNotes(remote);
      return;
    }
    set({ notes: readStoredList<Note>(NOTES_KEY, []), hydrated: true });
  },
  addNote: ({ text, result, metrics, presetName }, limit = 0) => {
    if (!text.trim()) return;
    const note: Note = {
      id: newNoteId(),
      createdAt: new Date().toISOString(),
      title: deriveTitle(result),
      preview: text.slice(0, 70),
      transcript: text,
      organized: result,
      presetName,
      durationMs:
        (metrics?.asr?.durationMs ?? 0) + (metrics?.llm?.durationMs ?? 0),
      metrics,
    };
    const previous = get().notes;
    const next = limitNotes([note, ...previous], limit);
    set({ notes: next });
    const settings = useSettingsStore.getState().models;
    void saveHistory(note, settings)
      .then((saved) => {
        // 后端可能补齐了标题与预览；用它的版本替换乐观插入的那条。
        if (!saved) return;
        set((current) => ({
          notes: current.notes.map((entry) =>
            entry.id === saved.id ? saved : entry,
          ),
        }));
      })
      .catch(() => {
        // 预览环境没有后端；桌面端写库失败时保留本地副本，
        // 下次启动会通过迁移逻辑再补一次。
        writeStored(NOTES_KEY, limitNotes([note, ...previous], limit));
      });
  },
  removeNote: async (id) => {
    set((current) => ({
      notes: current.notes.filter((note) => note.id !== id),
    }));
    try {
      await deleteHistory(id);
    } catch {
      // 后端不可用时界面已经移除；下次 hydrate 会重新对齐。
    }
    writeStored(
      NOTES_KEY,
      readStoredList<Note>(NOTES_KEY, []).filter((note) => note.id !== id),
    );
  },
  clearNotes: async () => {
    set({ notes: [] });
    try {
      await clearHistory();
    } catch {
      // 同上。
    }
    removeStored(NOTES_KEY);
  },
}));

// migrateLocalNotes 把旧版 localStorage 里的历史一次性搬进 SQLite。
// 只有第一次成功、或者确实没有旧数据时才会删掉本地副本——顺序反了
// 就等于丢数据。
async function migrateLocalNotes(remote: Note[]) {
  const legacy = readStoredList<Note>(NOTES_KEY, []);
  if (!legacy.length) return;
  const existing = new Set(remote.map((note) => note.id));
  const pending = legacy.filter((note) => !existing.has(note.id));
  if (!pending.length) {
    removeStored(NOTES_KEY);
    return;
  }
  try {
    const settings = useSettingsStore.getState().models;
    await importHistory(pending, settings);
    removeStored(NOTES_KEY);
  } catch {
    // 导入失败时保留本地副本，下次启动再试。
  }
}

// newNoteId 用 UUID；crypto.randomUUID 只在安全上下文可用，
// 预览与旧 WebView 里退回时间戳加随机串。
function newNoteId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
