import { describe, expect, it } from 'vitest';

import { formatRelativeTime } from './format';

const pad = (value: number) => String(value).padStart(2, '0');

describe('formatRelativeTime', () => {
  it('今天显示时刻', () => {
    const now = new Date();
    const today = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      9,
      5,
    );
    const text = formatRelativeTime(today.toISOString());
    // 具体分隔符随 ICU 版本变化，这里只断言时分数字出现。
    expect(text).toContain(pad(9));
    expect(text).toContain(pad(5));
  });

  it('今年更早显示月日', () => {
    const now = new Date();
    const earlier = new Date(now.getFullYear(), 0, 3, 12, 0);
    const text = formatRelativeTime(earlier.toISOString());
    expect(text).not.toContain(String(now.getFullYear()));
    expect(text).toContain('3');
  });

  it('跨年显示年月日', () => {
    const text = formatRelativeTime(new Date(2020, 4, 17, 8, 0).toISOString());
    expect(text).toContain('2020');
  });

  it('空值与非法值给出破折号', () => {
    expect(formatRelativeTime(undefined)).toBe('—');
    expect(formatRelativeTime('not-a-date')).toBe('—');
  });
});
