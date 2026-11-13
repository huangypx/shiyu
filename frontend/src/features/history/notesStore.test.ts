import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings/settingsStore';
import { DEFAULT_DESKTOP_SETTINGS, DEFAULT_SETTINGS } from '@/types/models';

import { useNotesStore } from './notesStore';

const bridge = vi.hoisted(() => ({
  loadHistory: vi.fn(),
  loadOlderHistory: vi.fn(),
  saveHistory: vi.fn(),
  deleteHistory: vi.fn(),
  clearHistory: vi.fn(),
  importHistory: vi.fn(),
}));

vi.mock('@/services/bridge', () => bridge);

const note = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  createdAt: new Date().toISOString(),
  title: `标题 ${id}`,
  preview: `预览 ${id}`,
  transcript: `原文 ${id}`,
  organized: `## 标题 ${id}`,
  ...overrides,
});

describe('notesStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    bridge.saveHistory.mockResolvedValue(undefined);
    bridge.loadHistory.mockResolvedValue(undefined);
    bridge.importHistory.mockResolvedValue(0);
    useSettingsStore.setState({
      models: DEFAULT_SETTINGS,
      desktop: DEFAULT_DESKTOP_SETTINGS,
    });
    useNotesStore.setState({
      notes: [],
      hydrated: false,
      olderAfter: null,
      loadingOlder: false,
    });
  });

  it('hydrate 从后端拉取历史', async () => {
    bridge.loadHistory.mockResolvedValue([note('a')]);
    await useNotesStore.getState().hydrate();
    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(useNotesStore.getState().hydrated).toBe(true);
  });

  it('新增记录会乐观插入并写回后端', async () => {
    bridge.loadHistory.mockResolvedValue([]);
    bridge.saveHistory.mockImplementation((entry) =>
      Promise.resolve({ ...entry, title: '后端标题' }),
    );
    await useNotesStore.getState().hydrate();

    useNotesStore.getState().addNote({ text: '原文', result: '## 会议纪要' });
    expect(useNotesStore.getState().notes[0].title).toBe('会议纪要');

    // 后端返回后替换成服务端版本（预览截断、补齐字段都在那边）。
    await Promise.resolve();
    await Promise.resolve();
    expect(useNotesStore.getState().notes[0].title).toBe('后端标题');
    expect(bridge.saveHistory).toHaveBeenCalledTimes(1);
  });

  it('可从历史页继续读取第一百条以前的全文', async () => {
    const entries = Array.from({ length: 101 }, (_, index) =>
      note(String(index)),
    );
    bridge.loadHistory.mockResolvedValue(entries);
    bridge.loadOlderHistory.mockResolvedValue(entries.slice(100));
    await useNotesStore.getState().hydrate();
    expect(useNotesStore.getState().notes).toHaveLength(100);
    await useNotesStore.getState().loadOlder();
    expect(bridge.loadOlderHistory).toHaveBeenCalledWith(101, entries[99]);
    expect(useNotesStore.getState().notes[100]).toEqual(entries[100]);
    expect(useNotesStore.getState().olderAfter).toBeNull();
  });

  it('后端不可用时保留本地副本，供下次迁移', async () => {
    bridge.loadHistory.mockResolvedValue([]);
    await useNotesStore.getState().hydrate();
    bridge.saveHistory.mockRejectedValue(new Error('没有后端'));

    useNotesStore.getState().addNote({ text: '原文', result: '整理结果' });
    await Promise.resolve();
    await Promise.resolve();

    expect(useNotesStore.getState().notes).toHaveLength(1);
    expect(localStorage.getItem('typeless-notes')).toContain('原文');
  });

  it('删除与清空都会同步后端', async () => {
    bridge.deleteHistory.mockResolvedValue(undefined);
    bridge.clearHistory.mockResolvedValue(undefined);
    bridge.loadHistory.mockResolvedValue([note('a'), note('b')]);
    await useNotesStore.getState().hydrate();

    await useNotesStore.getState().removeNote('a');
    expect(useNotesStore.getState().notes.map((entry) => entry.id)).toEqual([
      'b',
    ]);
    expect(bridge.deleteHistory).toHaveBeenCalledWith('a');

    await useNotesStore.getState().clearNotes();
    expect(useNotesStore.getState().notes).toHaveLength(0);
    expect(bridge.clearHistory).toHaveBeenCalled();
  });

  it('首次挂载时把本地旧记录迁移进后端', async () => {
    const legacy = [note('old', { createdAt: '2026-01-01T00:00:00.000Z' })];
    localStorage.setItem('typeless-notes', JSON.stringify(legacy));
    bridge.loadHistory.mockResolvedValue([]);
    bridge.importHistory.mockResolvedValue(1);

    await useNotesStore.getState().hydrate();

    expect(bridge.importHistory).toHaveBeenCalledTimes(1);
    expect(useNotesStore.getState().notes).toEqual(legacy);
    // 导入成功后清空本地副本，避免下次重复导入。
    expect(localStorage.getItem('typeless-notes')).toBeNull();
  });

  it('预览模式重新打开时可以找回完整原文和整理结果', async () => {
    const text = '这是一条需要保留的原文。'.repeat(15);
    useNotesStore.getState().addNote({ text, result: '一、确认时间' });
    await Promise.resolve();
    await Promise.resolve();
    useNotesStore.setState({ notes: [], hydrated: false });
    await useNotesStore.getState().hydrate();
    expect(useNotesStore.getState().notes[0]).toMatchObject({
      transcript: text,
      organized: '一、确认时间',
    });
  });

  it('后端已有同一批记录时直接清掉本地副本', async () => {
    localStorage.setItem('typeless-notes', JSON.stringify([note('a')]));
    bridge.loadHistory.mockResolvedValue([note('a')]);

    await useNotesStore.getState().hydrate();

    expect(bridge.importHistory).not.toHaveBeenCalled();
    expect(localStorage.getItem('typeless-notes')).toBeNull();
  });
});
