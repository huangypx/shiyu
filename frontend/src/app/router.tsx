import { createHashRouter, Navigate } from 'react-router-dom';

import AppShell from '@/app/layout/AppShell';
import CallsPage from '@/pages/calls/CallsPage';
import HistoryPage from '@/pages/history/HistoryPage';
import RecordPage from '@/pages/record/RecordPage';

// 桌面外壳由 Wails 的 assetserver 提供，只有一份 index.html；
// path 路由刷新会 404，hash 路由在 dev、打包和浏览器预览里都稳定。
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <RecordPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'calls', element: <CallsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
