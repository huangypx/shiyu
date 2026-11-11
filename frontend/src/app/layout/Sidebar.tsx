import { Button, IconButton, Kbd, Tooltip } from '@radix-ui/themes';
import {
  Activity,
  History,
  PanelLeftClose,
  PenLine,
  Plus,
  Settings,
  X,
} from 'lucide-react';
import { useEffect, useRef } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';

import BrandMark from '@/components/BrandMark';
import { useCallsStore } from '@/features/calls/callsStore';
import { useTitlebarDoubleClick } from '@/features/desktop/useTitlebarDoubleClick';
import { useNotesStore } from '@/features/history/notesStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { formatShortcut } from '@/lib/shortcut';
import { useMediaQuery } from '@/lib/useMediaQuery';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import styles from './Sidebar.module.css';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem}` : styles.navItem;

export default function Sidebar() {
  const navigate = useNavigate();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const closeSidebar = useUiStore((state) => state.closeSidebar);
  const sidebarCollapsed = useUiStore((state) => state.sidebarCollapsed);
  const toggleSidebarCollapsed = useUiStore(
    (state) => state.toggleSidebarCollapsed,
  );
  const openSettings = useUiStore((state) => state.openSettings);
  const notesCount = useNotesStore((state) => state.notes.length);
  const callsCount = useCallsStore((state) => state.calls.length);
  const { clearDraft } = useRecordingActions();
  // 抽屉形态下头部按钮的职责是「关闭」，而不是把侧栏折叠进布局外。
  const isDrawer = useMediaQuery('(max-width: 680px)');
  const platform = useDesktopStore((state) => state.runtime.platform);
  const asideRef = useRef<HTMLElement>(null);
  // 侧栏头部与顶带共用同一条 36px 标题带，双击空白处应当和系统
  // caption 一样最大化/还原；抽屉形态下这块是浮层标题，不接管。
  const handleTitlebarDoubleClick = useTitlebarDoubleClick(!isDrawer);

  // 折叠后侧栏仍留在 DOM 里做位移动画；宽度归零时它不该再被
  // Tab 或读屏命中，所以用 inert 而不是只靠视觉隐藏。
  useEffect(() => {
    asideRef.current?.toggleAttribute('inert', sidebarCollapsed && !isDrawer);
  }, [isDrawer, sidebarCollapsed]);

  return (
    <aside
      ref={asideRef}
      className={
        sidebarOpen ? `${styles.sidebar} ${styles.open}` : styles.sidebar
      }
      data-collapsed={sidebarCollapsed ? 'true' : 'false'}
    >
      <div className={styles.header} onDoubleClick={handleTitlebarDoubleClick}>
        {/* 品牌标记与应用图标同源，但只有单色：彩色砖块会压过 14px 的应用名，
            也让置顶的品牌位比导航项更响。 */}
        <BrandMark size={18} className={styles.brandMark} />
        <span className={styles.brandName}>拾语</span>
        <Tooltip
          content={
            isDrawer
              ? '关闭菜单'
              : `收起侧栏 (${formatShortcut(platform, '\\')})`
          }
        >
          <IconButton
            className={styles.headerToggle}
            variant="ghost"
            color="gray"
            size="1"
            aria-label={isDrawer ? '关闭菜单' : '收起侧栏'}
            onClick={() => {
              if (isDrawer) closeSidebar();
              else toggleSidebarCollapsed();
            }}
          >
            {isDrawer ? <X size={15} /> : <PanelLeftClose size={16} />}
          </IconButton>
        </Tooltip>
      </div>

      <div className={styles.body}>
        <Button
          variant="surface"
          color="gray"
          size="2"
          className={styles.newNote}
          onClick={() => {
            clearDraft();
            void navigate('/');
            closeSidebar();
          }}
        >
          <Plus size={15} /> 新建记录
          <Kbd className={styles.shortcut}>{formatShortcut(platform, 'N')}</Kbd>
        </Button>

        <nav className={styles.nav} aria-label="主导航">
          <NavLink to="/" end className={navClass} onClick={closeSidebar}>
            <PenLine size={15} /> 开始记录
          </NavLink>
          <NavLink to="/history" className={navClass} onClick={closeSidebar}>
            <History size={15} /> 历史记录
            <span className={styles.navCount}>{notesCount || ''}</span>
          </NavLink>
          <NavLink to="/calls" className={navClass} onClick={closeSidebar}>
            <Activity size={15} /> 调用记录
            <span className={styles.navCount}>{callsCount || ''}</span>
          </NavLink>
        </nav>

        <div className={styles.bottom}>
          <button
            type="button"
            className={styles.navItem}
            onClick={() => {
              openSettings();
              closeSidebar();
            }}
          >
            <Settings size={15} /> 偏好设置
          </button>
        </div>
      </div>
    </aside>
  );
}
