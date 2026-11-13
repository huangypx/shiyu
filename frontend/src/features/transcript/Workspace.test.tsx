import { Theme } from '@radix-ui/themes';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  type AsrModelConfig,
  DEFAULT_ASR_MODEL,
  DEFAULT_LLM_MODEL,
  DEFAULT_SETTINGS,
  type LlmModelConfig,
} from '@/types/models';

import Workspace from './Workspace';

type WorkspaceProps = ComponentProps<typeof Workspace>;

const asrModel: AsrModelConfig = {
  ...DEFAULT_ASR_MODEL,
  id: 'asr-test',
  name: '本地转写',
  model: 'whisper-1',
};

const llmModel: LlmModelConfig = {
  ...DEFAULT_LLM_MODEL,
  id: 'llm-test',
  name: '整理模型',
  model: 'gpt-4.1-mini',
};

// 记录页不再显示调用概要条，测试里也就不需要构造调用明细。
function workspaceProps(
  overrides: Partial<WorkspaceProps> = {},
): WorkspaceProps {
  return {
    status: 'idle',
    stage: null,
    transcript: '你好',
    organized: '',
    copied: '',
    presets: DEFAULT_SETTINGS.presets,
    activePresetId: DEFAULT_SETTINGS.activePresetId,
    asrModel,
    llmModel,
    asrModels: [asrModel],
    llmModels: [llmModel],
    language: DEFAULT_SETTINGS.language,
    split: 0.5,
    onSplitChange: vi.fn(),
    onToggleRecording: vi.fn(),
    onTranscriptChange: vi.fn(),
    onOrganizedChange: vi.fn(),
    onOrganize: vi.fn(),
    onCopyTranscript: vi.fn(),
    onCopyResult: vi.fn(),
    onSelectPreset: vi.fn(),
    onSelectAsrModel: vi.fn(),
    onSelectLlmModel: vi.fn(),
    onSelectLanguage: vi.fn(),
    ...overrides,
  };
}

function renderWorkspace(overrides: Partial<WorkspaceProps> = {}) {
  return render(
    <Theme>
      <Workspace {...workspaceProps(overrides)} />
    </Theme>,
  );
}

describe('Workspace', () => {
  it('左右两栏同时可见，标题用产品确认的命名', () => {
    renderWorkspace();

    expect(screen.getByRole('region', { name: '识别结果' })).toBeVisible();
    expect(screen.getByRole('region', { name: '转写内容' })).toBeVisible();
    // 两栏都是可直接书写的文本域；右栏没有内容时用占位文案顶上。
    expect(screen.getByRole('textbox', { name: '识别结果' })).toBeVisible();
    expect(screen.getByRole('textbox', { name: '转写内容' })).toHaveAttribute(
      'placeholder',
      '还没有内容',
    );
  });

  it('没有文本时整理按钮禁用，有文本时才可整理', async () => {
    const onOrganize = vi.fn();
    const { unmount } = renderWorkspace({
      transcript: '   ',
      onOrganize,
    });
    expect(screen.getByRole('button', { name: '整理文字' })).toBeDisabled();
    unmount();

    const user = userEvent.setup();
    renderWorkspace({ transcript: '记一下明天的安排', onOrganize });

    const organize = screen.getByRole('button', { name: '整理文字' });
    expect(organize).toBeEnabled();
    await user.click(organize);
    expect(onOrganize).toHaveBeenCalledTimes(1);
  });

  it('两栏各有自己的复制按钮，只在自己那一栏生效', async () => {
    const onCopyTranscript = vi.fn();
    const onCopyResult = vi.fn();
    const user = userEvent.setup();
    renderWorkspace({
      transcript: '记一下明天的安排',
      organized: '## 会议纪要',
      onCopyTranscript,
      onCopyResult,
    });

    await user.click(screen.getByRole('button', { name: '复制识别结果' }));
    expect(onCopyTranscript).toHaveBeenCalledTimes(1);
    expect(onCopyResult).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '复制转写内容' }));
    expect(onCopyResult).toHaveBeenCalledTimes(1);
  });

  it('没有可复制内容时按钮禁用，复制后只有那一栏变成已复制', () => {
    const { rerender } = renderWorkspace({ transcript: '', organized: '' });
    expect(screen.getByRole('button', { name: '复制识别结果' })).toBeDisabled();
    // 没有结果时右栏脚只有字数，不出现复制与重新整理。
    expect(screen.queryByRole('button', { name: '复制转写内容' })).toBeNull();
    expect(screen.queryByRole('button', { name: '重新整理' })).toBeNull();

    rerender(
      <Theme>
        <Workspace
          {...workspaceProps({
            transcript: '记一下',
            organized: '## 纪要',
            copied: 'llm',
          })}
        />
      </Theme>,
    );
    expect(
      screen.getByRole('button', { name: '已复制转写内容' }),
    ).toBeVisible();
    // 左栏不受影响，仍是「复制」而不是「已复制」。
    expect(screen.getByRole('button', { name: '复制识别结果' })).toBeVisible();
  });

  it('转写内容天然可编辑，没有手动的编辑开关', async () => {
    const onOrganizedChange = vi.fn();
    const user = userEvent.setup();
    renderWorkspace({ organized: '## 会议纪要', onOrganizedChange });

    // 没有「编辑」「完成」这类模式按钮，正文本身就是文本域。
    expect(screen.queryByRole('button', { name: '编辑' })).toBeNull();
    expect(screen.queryByRole('button', { name: '完成' })).toBeNull();

    const textarea = screen.getByRole('textbox', { name: '转写内容' });
    expect(textarea).toHaveValue('## 会议纪要');
    expect(textarea).not.toHaveAttribute('readonly');
    await user.type(textarea, '！');
    expect(onOrganizedChange).toHaveBeenCalled();
  });

  it('LLM 输出期间右栏自动只读，输出完成后自动恢复可编辑', () => {
    const { rerender } = renderWorkspace({
      status: 'processing',
      stage: 'organize',
      transcript: '记一下明天的安排',
      organized: '## 会议纪要',
    });

    // 输出中两栏都只读、复制禁用：此时文本还会被下一段增量覆盖。
    expect(screen.getByRole('textbox', { name: '转写内容' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByRole('textbox', { name: '识别结果' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByRole('button', { name: '复制转写内容' })).toBeDisabled();

    // 输出完成（回到 idle）后两处都自动放开，不需要用户点任何按钮。
    rerender(
      <Theme>
        <Workspace
          {...workspaceProps({
            status: 'idle',
            transcript: '记一下明天的安排',
            organized: '## 会议纪要',
          })}
        />
      </Theme>,
    );
    expect(
      screen.getByRole('textbox', { name: '转写内容' }),
    ).not.toHaveAttribute('readonly');
    expect(screen.getByRole('button', { name: '复制转写内容' })).toBeEnabled();
  });

  it('栏头的模型与语言都是下拉框，显示当前生效的那一项', () => {
    renderWorkspace();

    // 触发框只写 model，完整端点信息挂在 title 上。
    const asr = screen.getByRole('combobox', { name: '语音识别模型' });
    expect(asr).toHaveTextContent('whisper-1');
    expect(asr).toHaveAttribute(
      'title',
      '本地转写 · openai-compatible · https://api.openai.com/v1',
    );

    const llm = screen.getByRole('combobox', { name: '整理模型' });
    expect(llm).toHaveTextContent('gpt-4.1-mini');

    // 语言取「中文（普通话）」里括号前的部分，菜单里仍是完整写法。
    expect(
      screen.getByRole('combobox', { name: '识别语言' }),
    ).toHaveTextContent('中文');
    expect(
      screen.getByRole('combobox', { name: '整理预设' }),
    ).toHaveTextContent('默认整理');
  });

  it('在栏头的下拉框里换模型、换语言会回传新值', async () => {
    const onSelectAsrModel = vi.fn();
    const onSelectLlmModel = vi.fn();
    const onSelectLanguage = vi.fn();
    const user = userEvent.setup();
    renderWorkspace({
      asrModels: [
        asrModel,
        {
          ...asrModel,
          id: 'asr-backup',
          name: '备用转写',
          model: 'whisper-large-v3',
        },
      ],
      llmModels: [
        llmModel,
        {
          ...llmModel,
          id: 'llm-cheap',
          name: '便宜整理',
          model: 'gpt-4o-mini',
        },
      ],
      onSelectAsrModel,
      onSelectLlmModel,
      onSelectLanguage,
    });

    await user.click(screen.getByRole('combobox', { name: '语音识别模型' }));
    await user.click(screen.getByRole('option', { name: /备用转写/ }));
    expect(onSelectAsrModel).toHaveBeenCalledWith('asr-backup');

    await user.click(screen.getByRole('combobox', { name: '整理模型' }));
    await user.click(screen.getByRole('option', { name: /便宜整理/ }));
    expect(onSelectLlmModel).toHaveBeenCalledWith('llm-cheap');

    await user.click(screen.getByRole('combobox', { name: '识别语言' }));
    await user.click(screen.getByRole('option', { name: 'English' }));
    expect(onSelectLanguage).toHaveBeenCalledWith('English');
  });

  it('左栏脚只有字数与复制、整理文字，没有清空', () => {
    renderWorkspace({ transcript: '记一下明天的安排' });

    expect(screen.getByText('8 字')).toBeVisible();
    // 清空入口已经去掉：换一份草稿走「新建记录」。
    expect(screen.queryByRole('button', { name: '清空' })).toBeNull();
  });

  it('整理结果直接写进右栏，不再需要翻面', () => {
    const organized =
      '## 会议纪要\n- [ ] 整理需求\n- 下周一评审\n**时长** 30 分钟';
    renderWorkspace({ organized });

    // 右栏是原文文本域，内容与字数都按看到的文字算。
    expect(screen.getByRole('textbox', { name: '转写内容' })).toHaveValue(
      organized,
    );
    expect(screen.getByText(`${organized.length} 字`)).toBeVisible();
    // 有结果才出现重新整理。
    expect(screen.getByRole('button', { name: '重新整理' })).toBeEnabled();
  });

  it('整理中右栏用占位说明在等输出，处理中重新整理禁用', () => {
    renderWorkspace({
      status: 'processing',
      stage: 'organize',
      organized: '',
      transcript: '记一下明天的安排',
    });

    expect(screen.getByRole('textbox', { name: '转写内容' })).toHaveAttribute(
      'placeholder',
      '正在整理，输出完成后可以编辑',
    );
    expect(screen.getByRole('button', { name: '整理文字' })).toBeDisabled();
  });

  it('记录页不显示调用明细，token 与耗时才去调用记录页看', () => {
    renderWorkspace();

    // 概要条整块不再渲染：既没有「等待调用」空条，也没有接口与 token 细节。
    expect(screen.queryByText('等待调用')).toBeNull();
    expect(screen.queryByText('语音识别')).toBeNull();
    expect(screen.queryByText('文字整理')).toBeNull();
    expect(screen.queryByText(/tok/)).toBeNull();
    expect(screen.queryByText('详情')).toBeNull();
  });

  it('分隔线能用方向键调整两栏比例，Home 键恢复居中', async () => {
    const onSplitChange = vi.fn();
    const user = userEvent.setup();
    renderWorkspace({ split: 0.5, onSplitChange });

    // 比例写在可访问名称里，读屏能听到当前左右宽度。
    const divider = screen.getByRole('button', {
      name: '调整两栏宽度，当前左栏 50%',
    });

    await user.click(divider);
    await user.keyboard('{ArrowRight}');
    expect(onSplitChange).toHaveBeenLastCalledWith(0.52);

    await user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(onSplitChange).toHaveBeenLastCalledWith(0.48);

    await user.keyboard('{Home}');
    expect(onSplitChange).toHaveBeenLastCalledWith(0.5);
  });

  it('左栏栏头只有模型、语言与录音控件，没有设置入口', async () => {
    const onToggleRecording = vi.fn();
    const user = userEvent.setup();
    renderWorkspace({ onToggleRecording });

    // 录音设置已经收进偏好设置弹窗，栏头不再放齿轮图标。
    expect(screen.queryByRole('button', { name: '录音设置' })).toBeNull();

    await user.click(screen.getByRole('button', { name: '开始录音' }));
    expect(onToggleRecording).toHaveBeenCalledTimes(1);
  });
});
