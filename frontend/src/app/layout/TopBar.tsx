import { Tooltip } from '@radix-ui/themes';
import { Activity, History, Minimize2, Plus, Settings } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import BrandMark from '@/components/BrandMark';
import { useTitlebarDoubleClick } from '@/features/desktop/useTitlebarDoubleClick';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { formatShortcut } from '@/lib/shortcut';
import { useDesktopStore } from '@/store/desktopStore';
import { useUiStore } from '@/store/uiStore';

import styles from './TopBar.module.css';
import WindowControls from './WindowControls';

// 品牌、页面导航和窗口操作都收在同一条 36px 顶带里。
// 导航项只写图标：顶带要和交通灯、窗口按钮共用一行，文字标签会把它撑高。
export default function TopBar() {
  const navigate = useNavigate();
  const platform = useDesktopStore((state) => state.runtime.platform);
  const openSettings = useUiStore((state) => state.openSettings);
  const { clearDraft } = useRecordingActions();
  const { collapseWindow } = useWindowActions();
  // Windows/Linux 没有系统 caption，窗口按钮就落在顶带右端；
  // macOS 用原生交通灯，顶带不需要额外留白。
  const hasWindowControls = platform === 'windows' || platform === 'linux';
  const handleTitlebarDoubleClick = useTitlebarDoubleClick();

  return (
    <header
      className={styles.topbar}
      data-has-controls={hasWindowControls ? 'true' : 'false'}
      onDoubleClick={handleTitlebarDoubleClick}
    >
      <Link to="/" className={styles.brand} aria-label="拾语，返回编辑器">
        <BrandMark size={18} />
        <span className={styles.brandName}>拾语</span>
      </Link>

      <nav className={styles.nav} aria-label="主导航">
        <Tooltip content={`新建记录 (${formatShortcut(platform, 'N')})`}>
          <button
            type="button"
            className={styles.action}
            aria-label="新建记录"
            onClick={() => {
              clearDraft();
              void navigate('/');
            }}
          >
            <Plus size={16} />
          </button>
        </Tooltip>
        <Tooltip content="历史记录">
          <NavLink
            to="/history"
            className={styles.action}
            aria-label="历史记录"
          >
            <History size={16} />
          </NavLink>
        </Tooltip>
        <Tooltip content="调用记录">
          <NavLink to="/calls" className={styles.action} aria-label="调用记录">
            <Activity size={16} />
          </NavLink>
        </Tooltip>
      </nav>

      <div className={styles.actions}>
        <Tooltip content={`偏好设置 (${formatShortcut(platform, ',')})`}>
          <button
            type="button"
            className={styles.action}
            aria-label="偏好设置"
            onClick={openSettings}
          >
            <Settings size={16} />
          </button>
        </Tooltip>
        <Tooltip content="收进悬浮球">
          <button
            type="button"
            className={styles.action}
            aria-label="收进悬浮球"
            onClick={() => void collapseWindow()}
          >
            <Minimize2 size={15} />
          </button>
        </Tooltip>
      </div>

      <WindowControls platform={platform} />
    </header>
  );
}
