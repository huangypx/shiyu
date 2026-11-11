import { Theme } from '@radix-ui/themes';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '@/types/models';

import EditorCard from './EditorCard';

type CardProps = ComponentProps<typeof EditorCard>;

function cardProps(overrides: Partial<CardProps> = {}): CardProps {
  return {
    status: 'idle',
    transcript: '你好',
    organized: '',
    isProcessing: false,
    isOrganizing: false,
    copied: false,
    metrics: {},
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

function renderCard(overrides: Partial<CardProps> = {}) {
  return render(
    <Theme>
      <EditorCard {...cardProps(overrides)} />
    </Theme>,
  );
}

// 翻面先等退出动画结束才挂新面，新面还要从 opacity: 0 淡入；
// 断言因此必须轮询到它真正可见，而不是刚出现在 DOM 里。
async function expectFace(name: '原始记录' | '整理结果') {
  await waitFor(
    () => expect(screen.getByRole('region', { name })).toBeVisible(),
    { timeout: 3000 },
  );
}

describe('EditorCard', () => {
  it('没有整理结果时只渲染原始记录一面', () => {
    renderCard();

    expect(screen.getByRole('region', { name: '原始记录' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '整理结果' })).toBeNull();
  });

  it('挂载时已有结果就直接落在整理结果一面', () => {
    renderCard({ organized: '## 会议纪要\n- 下周同步' });

    expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible();
    expect(screen.queryByRole('region', { name: '原始记录' })).toBeNull();
  });

  it('背面始终在 DOM 里，但不进可访问性树也不会被聚焦', () => {
    renderCard({ organized: '' });

    const back = document.querySelector('[data-face="result"]');
    expect(back).not.toBeNull();
    expect(back).toHaveAttribute('aria-hidden', 'true');
    expect(back).toHaveAttribute('inert');
    // 读屏与 Tab 只看到当前这一面。
    expect(screen.queryByRole('region', { name: '整理结果' })).toBeNull();
  });

  it('整理结果到达后翻到结果一面，原文那一面收起来', async () => {
    const { rerender } = renderCard({ transcript: '记一下明天的安排' });

    rerender(
      <Theme>
        <EditorCard
          {...cardProps({
            transcript: '记一下明天的安排',
            organized: '## 明天的安排\n- 十点开会',
          })}
        />
      </Theme>,
    );

    await expectFace('整理结果');
    expect(screen.queryByRole('region', { name: '原始记录' })).toBeNull();
  });

  it('可以手动翻回原文，再翻回整理结果', async () => {
    renderCard({ organized: '## 会议纪要' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '翻回原始记录' }));
    await expectFace('原始记录');

    await user.click(screen.getByRole('button', { name: '翻到整理结果' }));
    await expectFace('整理结果');
  });

  it('结果被清空后回到原始记录一面', async () => {
    const { rerender } = renderCard({ organized: '## 会议纪要' });
    expect(screen.getByRole('region', { name: '整理结果' })).toBeVisible();

    rerender(
      <Theme>
        <EditorCard {...cardProps({ organized: '' })} />
      </Theme>,
    );

    await expectFace('原始记录');
  });

  it('翻到空结果后开始新录音，自动回到原始记录一面', async () => {
    const { rerender } = renderCard({ organized: '' });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: '翻到整理结果' }));
    await expectFace('整理结果');

    rerender(
      <Theme>
        <EditorCard {...cardProps({ status: 'recording', organized: '' })} />
      </Theme>,
    );

    await expectFace('原始记录');
  });

  it('两面都显示当前预设，没有结果时复制不可用', async () => {
    renderCard({ organized: '' });
    const user = userEvent.setup();

    expect(
      screen.getByRole('combobox', { name: '整理预设' }),
    ).toHaveTextContent('默认整理');

    await user.click(screen.getByRole('button', { name: '翻到整理结果' }));
    await expectFace('整理结果');
    expect(
      screen.getByRole('combobox', { name: '整理预设' }),
    ).toHaveTextContent('默认整理');
    expect(screen.getByRole('button', { name: '复制结果' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '整理文字' })).toBeEnabled();
  });

  it('Markdown 预览把标题、列表与待办渲染成结构', () => {
    renderCard({
      organized: '## 会议纪要\n- [ ] 整理需求\n- 下周一评审\n**时长** 30 分钟',
    });

    expect(
      screen.getByRole('heading', { name: '会议纪要', level: 3 }),
    ).toBeVisible();
    expect(screen.getByText('整理需求')).toBeVisible();
    expect(screen.getByText('下周一评审')).toBeVisible();
    expect(screen.getByText('时长')).toBeVisible();
  });
});
