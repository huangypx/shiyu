import { IconButton, Tooltip } from '@radix-ui/themes';
import { Menu, Minimize2, PanelLeftOpen, Plus, X } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

import { useTitlebarDoubleClick } from '@/features/desktop/useTitlebarDoubleClick';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useWindowTransitionStore } from '@/features/desktop/windowTransitionStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { formatShortcut } from '@/lib/shortcut';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import styles from './TopBar.module.css';
import WindowControls from './WindowControls';

// 面包屑只描述位置，不承担导航：桌面外壳没有多层级路径。
function crumbTitle(pathname: string) {
  if (pathname === '/history') return '历史记录';
  if (pathname === '/calls') return '调用记录';
  return '新的记录';
}

export default function TopBar() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebarCollapsed = useUiStore(
    (state) => state.toggleSidebarCollapsed,
  );
  const { toggleWindowMode } = useWindowActions();
  const transitioning = useWindowTransitionStore(
    (state) => state.transition !== null,
  );
  const { clearDraft } = useRecordingActions();
  const isDrawer = useMediaQuery('(max-width: 680px)');
  const platform = useDesktopStore((state) => state.runtime.platform);
  // 侧栏收起后顶栏接管窗口左上角：第一个控件是展开按钮，
  // 后面补一个「新建记录」，主操作不会跟着侧栏一起消失。
  const showCollapsedControls = sidebarCollapsed && !isDrawer;
  // Windows/Linux 没有系统 caption，窗口按钮就落在顶带右端；
  // macOS 用原生交通灯，顶带不需要额外留白。
  const hasWindowControls = platform === 'windows' || platform === 'linux';
  const handleTitlebarDoubleClick = useTitlebarDoubleClick();

  return (
    <header
      className={styles.topbar}
      data-collapsed={showCollapsedControls ? 'true' : 'false'}
      data-has-controls={hasWindowControls ? 'true' : 'false'}
      onDoubleClick={handleTitlebarDoubleClick}
    >
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

      {showCollapsedControls && (
        <div className={styles.leading}>
          <Tooltip content={`展开侧栏 (${formatShortcut(platform, '\\')})`}>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              aria-label="展开侧栏"
              onClick={toggleSidebarCollapsed}
            >
              <PanelLeftOpen size={16} />
            </IconButton>
          </Tooltip>
          <Tooltip content={`新建记录 (${formatShortcut(platform, 'N')})`}>
            <IconButton
              variant="ghost"
              color="gray"
              size="2"
              aria-label="新建记录"
              onClick={() => {
                clearDraft();
                void navigate('/');
              }}
            >
              <Plus size={16} />
            </IconButton>
          </Tooltip>
        </div>
      )}

      <div className={styles.crumb}>
        <span>工作区</span>
        <span>/</span>
        <strong>{crumbTitle(pathname)}</strong>
      </div>

      <div className={styles.actions}>
        <Tooltip content="收进悬浮球">
          <IconButton
            variant="ghost"
            color="gray"
            size="2"
            aria-label="收进悬浮球"
            disabled={transitioning}
            onClick={toggleWindowMode}
          >
            <Minimize2 size={15} />
          </IconButton>
        </Tooltip>
      </div>

      <WindowControls platform={platform} />
    </header>
  );
}
