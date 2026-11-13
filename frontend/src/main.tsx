import '@radix-ui/themes/styles.css';
import '@/styles/theme.css';
import '@/styles/palettes.css';
import '@/styles/global.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/app/App';
import BubbleApp from '@/app/BubbleApp';
import OverlayApp from '@/app/OverlayApp';
import { AppTheme } from '@/app/providers';
import { desktopView } from '@/app/view';
import { defaultBackdrop, detectPlatform } from '@/services/platform';

// 在首帧绘制前写入平台信息：窗口层高度和平台控件尺寸
// 一次到位，避免标题栏先按浏览器尺寸渲染再跳动。
const platform = detectPlatform();
document.documentElement.dataset.platform = platform;
document.documentElement.dataset.backdrop = defaultBackdrop(platform);

const Root =
  desktopView === 'bubble'
    ? BubbleApp
    : desktopView === 'overlay'
      ? OverlayApp
      : App;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppTheme>
      <Root />
    </AppTheme>
  </StrictMode>,
);
