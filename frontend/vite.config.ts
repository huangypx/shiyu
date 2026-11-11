/// <reference types="vitest/config" />
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import wails from '@wailsio/runtime/plugins/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  // wails 插件负责把 /wails/runtime.js 和生成的 bindings 接进 Vite；
  // 纯浏览器预览没有 Wails 后端，bridge 会走 mock 分支。
  plugins: [react(), wails('./bindings')],
  // 别名让深层 feature 目录不必写 ../../..。
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 必须显式绑定 IPv4：Vite 默认的 localhost 在 macOS 上可能只监听 ::1，
  // 而 Wails 的 dev proxy 通过 127.0.0.1 连接，会得到 connection refused。
  server: { host: '127.0.0.1', port: 5173 },
  // 桌面外壳里没有测试入口，jsdom 只为组件测试服务。
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    passWithNoTests: true,
  },
});
