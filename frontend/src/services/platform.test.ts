import { afterEach, describe, expect, it } from 'vitest';

import { detectPlatform } from './platform';

type HostWindow = Window & {
  _wails?: { environment?: { OS?: string } };
};

function setUpHost(os?: string, search = '') {
  const host = window as HostWindow;
  if (os === undefined) delete host._wails;
  else host._wails = { environment: { OS: os } };
  window.history.replaceState(null, '', `/${search}`);
}

afterEach(() => {
  delete (window as HostWindow)._wails;
  window.history.replaceState(null, '', '/');
});

describe('detectPlatform', () => {
  it('没有宿主环境对象时按浏览器预览处理', () => {
    setUpHost();
    expect(detectPlatform()).toBe('web');
  });

  it('前端包自己创建的 _wails 不算桌面宿主', () => {
    setUpHost();
    (window as HostWindow)._wails = {};
    expect(detectPlatform()).toBe('web');
  });

  it('按宿主上报的 OS 判断平台', () => {
    setUpHost('darwin');
    expect(detectPlatform()).toBe('darwin');
    setUpHost('windows');
    expect(detectPlatform()).toBe('windows');
    setUpHost('linux');
    expect(detectPlatform()).toBe('linux');
  });

  it('查询参数可以覆盖宿主平台，方便浏览器评审', () => {
    setUpHost('darwin', '?platform=web');
    expect(detectPlatform()).toBe('web');
    setUpHost(undefined, '?platform=windows');
    expect(detectPlatform()).toBe('windows');
  });
});
