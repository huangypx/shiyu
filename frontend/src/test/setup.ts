// Testing Library 的断言扩展，测试文件不必各自引入。
import '@testing-library/jest-dom/vitest';

// jsdom 缺少浏览器里必然存在的几个 API：Radix 的弹层监听
// 尺寸，主题解析监听系统配色，因此统一在这里补最小实现。
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom 没有 scrollIntoView：Radix 的 Select 打开菜单时要把高亮项滚进视口。
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}

if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
}

// jsdom 没有实现 elementFromPoint；浮动球的失焦悬停要按坐标命中
// 按钮，测试里先补一个返回 null 的最小实现，再按需 spy。
if (!('elementFromPoint' in document)) {
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    writable: true,
    value: () => null,
  });
}
