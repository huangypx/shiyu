import { describe, expect, it } from 'vitest';

import {
  activePreset,
  duplicatePreset,
  MAX_PRESET_PROMPT_BYTES,
  MAX_PRESETS,
  newPreset,
  presetListError,
  presetValidation,
  removePreset,
  upsertPreset,
} from './presets';

const preset = (id: string, name = id) => ({
  id,
  name,
  systemPrompt: `prompt ${id}`,
});

describe('presets', () => {
  it('新建预设带唯一 ID 与空提示词', () => {
    const first = newPreset(1);
    const second = newPreset(2);
    expect(first.id).not.toBe(second.id);
    expect(first.name).toBe('新预设 1');
    expect(first.systemPrompt).toBe('');
    expect(presetValidation(first)).toBe('请填写系统提示词');
  });

  it('upsert 追加新条目并覆盖已有条目', () => {
    const list = [preset('a')];
    expect(upsertPreset(list, preset('b'))).toHaveLength(2);
    const updated = upsertPreset(list, { ...preset('a'), name: '新名字' });
    expect(updated).toHaveLength(1);
    expect(updated[0].name).toBe('新名字');
  });

  it('达到上限后不再追加', () => {
    const list = Array.from({ length: MAX_PRESETS }, (_, i) => preset(`p${i}`));
    expect(upsertPreset(list, preset('extra'))).toBe(list);
    expect(duplicatePreset(list, 'p0')).toBe(list);
  });

  it('复制插入到原条目之后并保留提示词', () => {
    const list = [preset('a'), preset('b')];
    const next = duplicatePreset(list, 'a', () => 'copy');
    expect(next.map((entry) => entry.id)).toEqual(['a', 'copy', 'b']);
    expect(next[1].systemPrompt).toBe('prompt a');
    expect(next[1].name).toBe('a 副本');
  });

  it('删除保留至少一个预设，并改选相邻条目', () => {
    const list = [preset('a'), preset('b'), preset('c')];
    const kept = removePreset(list, 'b', 'a');
    expect(kept.presets.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(kept.activePresetId).toBe('a');

    // 删掉的正好是生效项：落到删除位置之后的那一条。
    const reassigned = removePreset(list, 'a', 'a');
    expect(reassigned.activePresetId).toBe('b');

    const single = [preset('only')];
    expect(removePreset(single, 'only', 'only').presets).toBe(single);
  });

  it('校验名称、提示词与字节上限', () => {
    expect(presetValidation(preset('a'))).toBeNull();
    expect(presetValidation({ ...preset('a'), name: '  ' })).toBe(
      '请填写预设名称',
    );
    expect(
      presetValidation({ ...preset('a'), name: '名'.repeat(61) }),
    ).toContain('不能超过');
    const longPrompt = '字'.repeat(Math.floor(MAX_PRESET_PROMPT_BYTES / 3) + 1);
    expect(
      presetValidation({ ...preset('a'), systemPrompt: longPrompt }),
    ).toContain('字节');
    expect(presetListError([])).toBe('至少保留一个预设');
    expect(
      presetListError([preset('a'), { ...preset('a'), name: '另一个' }]),
    ).toContain('重复');
  });

  it('activePreset 在生效 ID 失配时回落到第一个', () => {
    const list = [preset('a'), preset('b')];
    expect(activePreset(list, 'b')?.id).toBe('b');
    expect(activePreset(list, 'gone')?.id).toBe('a');
    expect(activePreset([], 'gone')).toBeUndefined();
  });
});
