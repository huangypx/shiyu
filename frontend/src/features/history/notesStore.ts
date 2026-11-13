import { create } from 'zustand';

import { useSettingsStore } from '@/features/settings/settingsStore';
import {
  clearHistory,
  deleteHistory,
  importHistory,
  loadHistory,
  loadOlderHistory,
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
  olderAfter: Pick<Note, 'createdAt' | 'id'> | null;
  loadingOlder: boolean;
  loadOlder: () => Promise<void>;
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

const PAGE_SIZE = 100;

function historyPage(entries: Note[]) {
  const notes = entries.slice(0, PAGE_SIZE);
  const olderAfter = entries.length > PAGE_SIZE ? notes[PAGE_SIZE - 1] : null;
  return { notes, olderAfter };
}

export const useNotesStore = create<NotesState>()((set, get) => ({
  notes: [],
  olderAfter: null,
  loadingOlder: false,
  hydrated: false,
  // 启动时从 SQLite 拉一次；浏览器预览没有后端，退回本地副本。
  hydrate: async () => {
    const entries = await loadHistory(PAGE_SIZE + 1).catch(() => undefined);
    if (entries) {
      const { notes: remote, olderAfter } = historyPage(entries);
      const local = readStoredList<Note>(NOTES_KEY, []);
      const existing = new Set(remote.map((note) => note.id));
      const pending = local.filter((note) => !existing.has(note.id));
      const notes = pending.length
        ? [...remote, ...pending].sort((a, b) =>
            b.createdAt.localeCompare(a.createdAt),
          )
        : remote;
      set({ notes, olderAfter, loadingOlder: false, hydrated: true });
      if (local.length) await migrateLocalNotes(local, pending);
      return;
    }
    set({
      notes: readStoredList<Note>(NOTES_KEY, []),
      olderAfter: null,
      loadingOlder: false,
      hydrated: true,
    });
  },
  loadOlder: async () => {
    const { olderAfter, loadingOlder } = get();
    if (!olderAfter || loadingOlder) return;
    set({ loadingOlder: true });
    try {
      const entries = await loadOlderHistory(PAGE_SIZE + 1, olderAfter);
      if (!entries || get().olderAfter !== olderAfter) return;
      const page = historyPage(entries);
      set((state) => {
        const seen = new Set(state.notes.map((note) => note.id));
        return {
          notes: [
            ...state.notes,
            ...page.notes.filter((note) => !seen.has(note.id)),
          ],
          olderAfter: page.olderAfter,
          loadingOlder: false,
        };
      });
    } finally {
      if (get().olderAfter === olderAfter) set({ loadingOlder: false });
    }
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
    set((current) => ({ notes: limitNotes([note, ...current.notes], limit) }));
    const settings = useSettingsStore.getState().models;
    void saveHistory(note, settings)
      .catch(() => undefined)
      .then((saved) => {
        if (!saved) {
          // 只备份尚未写入数据库的文本，延迟的写入结果不能复活已删除的记录。
          if (get().notes.some((entry) => entry.id === note.id)) {
            const local = readStoredList<Note>(NOTES_KEY, []);
            writeStored(
              NOTES_KEY,
              limitNotes(
                [note, ...local].sort((a, b) =>
                  b.createdAt.localeCompare(a.createdAt),
                ),
                limit,
              ),
            );
          }
          return;
        }
        // 后端可能补齐了标题与预览；用它的版本替换乐观插入的那条。
        set((current) => ({
          notes: current.notes.map((entry) =>
            entry.id === saved.id ? saved : entry,
          ),
        }));
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
    set({ notes: [], olderAfter: null, loadingOlder: false });
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
async function migrateLocalNotes(local: Note[], pending: Note[]) {
  try {
    if (pending.length) {
      const settings = useSettingsStore.getState().models;
      await importHistory(pending, settings);
    }
    const imported = new Set(local.map((note) => note.id));
    const remaining = readStoredList<Note>(NOTES_KEY, []).filter(
      (note) => !imported.has(note.id),
    );
    if (remaining.length) writeStored(NOTES_KEY, remaining);
    else removeStored(NOTES_KEY);
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
