import { Theme } from '@radix-ui/themes';
import { useEffect, useLayoutEffect, useState } from 'react';

import { paletteById } from '@/lib/palettes';
import { useUiStore } from '@/store/uiStore';

// 固定明暗的主题不跟系统走：只有 pinned 为 null 时才回到用户偏好。
// 外观偏好可以是「跟随系统」，但 Radix Theme 只接受 light / dark
// 两个值，因此在这里把系统偏好解析成具体值。
function useResolvedAppearance(pinned: 'light' | 'dark' | null) {
  const preference = useUiStore((state) => state.appearance);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
  );

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const sync = () => setSystemPrefersDark(media.matches);
    const onChange = (event: MediaQueryListEvent) =>
      setSystemPrefersDark(event.matches);
    media.addEventListener('change', onChange);
    // 桌面外壳切到后台再回来时，WebView 可能漏掉一次
    // change 事件；重新获得焦点时补读一次当前值。
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      media.removeEventListener('change', onChange);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  if (pinned) return pinned;
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

export function AppTheme({ children }: { children: React.ReactNode }) {
  const palette = useUiStore((state) => state.palette);
  const spec = paletteById(palette);
  const appearance = useResolvedAppearance(spec.appearance);

  // Radix 的弹层渲染在 body 下，拿不到根容器的 data-palette，只能把
  // 主题写到 html 上让弹层也能继承色板。用 layout effect 是因为它
  // 在首绘前执行：深色主题启动时不会先闪一帧浅色。
  useLayoutEffect(() => {
    document.documentElement.dataset.palette = palette;
    return () => {
      delete document.documentElement.dataset.palette;
    };
  }, [palette]);

  return (
    <Theme
      data-palette={palette}
      appearance={appearance}
      accentColor={spec.accentColor}
      grayColor={spec.grayColor}
      radius="large"
      scaling="90%"
      panelBackground="solid"
      // 画布属于主窗口外壳；浮动模式必须整页透明，不能让
      // Radix 的根容器在圆形按钮后面画出一块底色。
      hasBackground={false}
      className="app-theme"
    >
      {children}
    </Theme>
  );
}
