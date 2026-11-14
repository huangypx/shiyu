import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DESKTOP_SETTINGS_KEY, SETTINGS_KEY } from '@/services/storage';
import {
  DEFAULT_DESKTOP_SETTINGS,
  DEFAULT_SETTINGS,
  type ModelSettings,
} from '@/types/models';

import { useSettingsStore } from './settingsStore';

const bridge = vi.hoisted(() => ({
  loadSettings: vi.fn(),
  loadDesktopSettings: vi.fn(),
  saveSettings: vi.fn(),
  saveDesktopSettings: vi.fn(),
  configureHotkey: vi.fn(),
  setActivePreset: vi.fn(),
  setActiveModel: vi.fn(),
}));

vi.mock('@/services/bridge', () => bridge);

// 复制一份默认设置：测试会改模型池，不能污染模块级常量。
function settings(overrides: Partial<ModelSettings> = {}): ModelSettings {
  return {
    ...DEFAULT_SETTINGS,
    asrModels: DEFAULT_SETTINGS.asrModels.map((model) => ({ ...model })),
    llmModels: DEFAULT_SETTINGS.llmModels.map((model) => ({ ...model })),
    presets: DEFAULT_SETTINGS.presets.map((preset) => ({ ...preset })),
    ...overrides,
  };
}

describe('settingsStore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    useSettingsStore.setState({
      models: settings(),
      desktop: { ...DEFAULT_DESKTOP_SETTINGS },
    });
  });

  it('hydrate 用后端配置覆盖本地值，并写回 localStorage', async () => {
    const remote = settings({
      asrModels: [
        {
          id: 'default',
          name: '默认模型',
          provider: 'openai-compatible',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: '',
          model: 'whisper-large-v3',
          mode: 'transcriptions',
        },
      ],
    });
    bridge.loadSettings.mockResolvedValue(remote);
    bridge.loadDesktopSettings.mockResolvedValue({
      ...DEFAULT_DESKTOP_SETTINGS,
      hotkey: 'Cmd+Shift+K',
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().models.asrModels[0].model).toBe(
      'whisper-large-v3',
    );
    expect(useSettingsStore.getState().desktop.hotkey).toBe('Cmd+Shift+K');
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('whisper-large-v3');
    expect(localStorage.getItem(DESKTOP_SETTINGS_KEY)).toContain('Cmd+Shift+K');
  });

  it('浏览器预览没有后端时保留本地值', async () => {
    bridge.loadSettings.mockResolvedValue(undefined);
    bridge.loadDesktopSettings.mockResolvedValue(undefined);
    useSettingsStore.setState({
      models: settings({
        llmModels: [
          {
            id: 'default',
            name: '默认模型',
            provider: 'openai-compatible',
            baseUrl: 'https://api.openai.com/v1',
            apiKey: '',
            model: 'local-model',
          },
        ],
      }),
    });

    await useSettingsStore.getState().hydrate();

    expect(useSettingsStore.getState().models.llmModels[0].model).toBe(
      'local-model',
    );
  });

  it('切换生效预设会写入本地并同步后端', async () => {
    bridge.setActivePreset.mockResolvedValue(undefined);

    await useSettingsStore.getState().selectPreset('markdown');

    expect(useSettingsStore.getState().models.activePresetId).toBe('markdown');
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('"markdown"');
    expect(bridge.setActivePreset).toHaveBeenCalledWith('markdown');
  });

  it('同步失败或预设不存在时仍保留本地选择', async () => {
    bridge.setActivePreset.mockRejectedValue(new Error('预览环境'));

    await useSettingsStore.getState().selectPreset('meeting');
    expect(useSettingsStore.getState().models.activePresetId).toBe('meeting');

    // 未知 ID 不写进状态，避免选择器指向一个不存在的预设。
    await useSettingsStore.getState().selectPreset('missing');
    expect(useSettingsStore.getState().models.activePresetId).toBe('meeting');
  });

  it('切换当前模型会同时落盘并同步后端', async () => {
    const withTwo = settings({
      llmModels: [
        ...DEFAULT_SETTINGS.llmModels,
        {
          id: 'cheap',
          name: '便宜模型',
          provider: 'openai-compatible',
          baseUrl: 'https://cheap.test/v1',
          apiKey: '',
          model: 'm-cheap',
        },
      ],
    });
    useSettingsStore.setState({ models: withTwo });
    bridge.setActiveModel.mockResolvedValue(undefined);

    await useSettingsStore.getState().selectModel('llm', 'cheap');

    expect(useSettingsStore.getState().models.activeLlmId).toBe('cheap');
    expect(bridge.setActiveModel).toHaveBeenCalledWith('llm', 'cheap');
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('cheap');

    // 未知 ID 不改变状态。
    await useSettingsStore.getState().selectModel('llm', 'missing');
    expect(useSettingsStore.getState().models.activeLlmId).toBe('cheap');
  });

  it('切换识别语言时写全局语言，并整份配置落盘', async () => {
    bridge.saveSettings.mockResolvedValue(undefined);

    await useSettingsStore.getState().selectLanguage('English');

    expect(useSettingsStore.getState().models.language).toBe('English');
    expect(localStorage.getItem(SETTINGS_KEY)).toContain('"English"');
    expect(bridge.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('当前模型自己设了语言时，只改模型上的覆盖值', async () => {
    bridge.saveSettings.mockResolvedValue(undefined);
    useSettingsStore.setState({
      models: settings({
        asrModels: [
          {
            ...DEFAULT_SETTINGS.asrModels[0],
            language: '日本語',
          },
        ],
      }),
    });

    await useSettingsStore.getState().selectLanguage('English');

    // 模型语言优先于全局，改全局不会影响下一次录音。
    expect(useSettingsStore.getState().models.asrModels[0].language).toBe(
      'English',
    );
    expect(useSettingsStore.getState().models.language).toBe(
      DEFAULT_SETTINGS.language,
    );
  });

  it('保存写回后端，桌面端不可用时报失败但仍落盘', async () => {
    bridge.saveSettings.mockResolvedValue(undefined);
    bridge.saveDesktopSettings.mockResolvedValue(undefined);
    bridge.configureHotkey.mockRejectedValue(new Error('预览环境'));

    const saved = await useSettingsStore.getState().save();

    expect(saved.ok).toBe(false);
    // 原因要带回界面：模板语法错这类失败必须让用户知道为什么没保存。
    expect(saved.error).toContain('预览环境');
    expect(localStorage.getItem(SETTINGS_KEY)).toContain(
      'gpt-4o-mini-transcribe',
    );
  });
});
