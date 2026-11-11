import { IconButton, Tooltip } from '@radix-ui/themes';
import { Menu, Minimize2, X } from 'lucide-react';
import { useLocation } from 'react-router-dom';

import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useUiStore } from '@/store/uiStore';

import styles from './TopBar.module.css';

// 面包屑只描述位置，不承担导航：桌面外壳没有多层级路径。
function crumbTitle(pathname: string) {
  if (pathname === '/history') return '历史记录';
  if (pathname === '/calls') return '调用记录';
  return '新的记录';
}

export default function TopBar() {
  const { pathname } = useLocation();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const { toggleWindowMode } = useWindowActions();

  return (
    <header className={styles.topbar}>
      <IconButton
        className={styles.menu}
        variant="ghost"
        color="gray"
        size="2"
        aria-label={sidebarOpen ? '关闭菜单' : '打开菜单'}
        aria-expanded={sidebarOpen}
        onClick={toggleSidebar}
      >
        {sidebarOpen ? <X size={16} /> : <Menu size={16} />}
      </IconButton>

      <div className={styles.crumb}>
        <span>工作区</span>
        <span>/</span>
        <strong>{crumbTitle(pathname)}</strong>
      </div>

      <div className={styles.actions}>
        <Tooltip content="浮动窗口">
          <IconButton
            variant="ghost"
            color="gray"
            size="2"
            aria-label="切换浮动窗口"
            onClick={toggleWindowMode}
          >
            <Minimize2 size={15} />
          </IconButton>
        </Tooltip>
      </div>
    </header>
  );
}
