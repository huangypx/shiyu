import { Theme } from '@radix-ui/themes';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/types/models';

import EditorCard from './EditorCard';

type CardProps = ComponentProps<typeof EditorCard>;

function cardProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    transcript: '你好',
    organized: '',
    busy: false,
    copied: false,
    presets: DEFAULT_SETTINGS.presets,
    activePresetId: DEFAULT_SETTINGS.activePresetId,
    onSelectPreset: vi.fn(),
    onTranscriptChange: vi.fn(),
    onClear: vi.fn(),
    onOrganize: vi.fn(),
    onCopy: vi.fn(),
    ...overrides,
  };
}

function view(props: CardProps) {
  return (
    <Theme>
      <EditorCard {...props} />
    </Theme>
  );
}

describe('EditorCard', () => {
  it('原文和整理结果同时可见，结果到达不会打断编辑', () => {
    const props = cardProps();
    const { rerender } = render(view(props));
    const source = screen.getByRole('textbox', { name: '原文' });
    source.focus();
    expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible();
    expect(screen.getByRole('button', { name: '复制结果' })).toBeDisabled();

    rerender(view({ ...props, organized: '你好。' }));
    expect(source).toHaveFocus();
    expect(source).toHaveValue('你好');
    expect(screen.getByText('你好。')).toBeVisible();
  });

  it('原文编辑、手动整理和结果复制各自调用对应动作', async () => {
    const user = userEvent.setup();
    const props = cardProps({ organized: '你好。' });
    render(view(props));
    fireEvent.change(screen.getByRole('textbox', { name: '原文' }), {
      target: { value: '新的原文' },
    });
    expect(props.onTranscriptChange).toHaveBeenCalledWith('新的原文');
    await user.click(screen.getByRole('button', { name: '重新整理' }));
    await user.click(screen.getByRole('button', { name: '复制结果' }));
    expect(props.onOrganize).toHaveBeenCalledTimes(1);
    expect(props.onCopy).toHaveBeenCalledTimes(1);
  });

  it('从原文选项切换预设和清空当前记录', async () => {
    const user = userEvent.setup();
    const props = cardProps({
      presets: [
        { id: 'base', name: '默认整理', systemPrompt: '整理' },
        { id: 'list', name: '清单', systemPrompt: '列点' },
      ],
      activePresetId: 'base',
    });
    render(view(props));
    const options = screen.getByRole('button', { name: '原文选项' });
    await user.click(options);
    expect(
      screen.getByRole('menuitemradio', { name: '默认整理' }),
    ).toBeChecked();
    await user.click(screen.getByRole('menuitemradio', { name: '清单' }));
    expect(props.onSelectPreset).toHaveBeenCalledWith('list');
    expect(props.onOrganize).not.toHaveBeenCalled();
    await user.click(options);
    await user.click(screen.getByRole('menuitem', { name: '清空本次记录' }));
    expect(props.onClear).toHaveBeenCalledTimes(1);
  });

  it('正在处理时禁止修改当前任务的原文和重复整理', async () => {
    const user = userEvent.setup();
    render(view(cardProps({ busy: true })));
    expect(screen.getByRole('textbox', { name: '原文' })).toHaveAttribute(
      'readonly',
    );
    expect(screen.getByRole('button', { name: '整理文字' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: '原文选项' }));
    expect(
      screen.getByRole('menuitem', { name: '清空本次记录' }),
    ).toHaveAttribute('aria-disabled', 'true');
  });

  it('Markdown 预览把标题、列表与待办渲染成结构', () => {
    render(
      view(
        cardProps({
          organized:
            '## 会议纪要\n- [ ] 整理需求\n- 下周一评审\n**时长** 30 分钟',
        }),
      ),
    );
    expect(
      screen.getByRole('heading', { name: '会议纪要', level: 3 }),
    ).toBeVisible();
    expect(screen.getByText('整理需求')).toBeVisible();
    expect(screen.getByText('下周一评审')).toBeVisible();
    expect(screen.getByText('时长')).toBeVisible();
  });
});
