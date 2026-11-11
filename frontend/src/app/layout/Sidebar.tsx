import { Button, Kbd } from '@radix-ui/themes';
import {
  Activity,
  AudioLines,
  History,
  PenLine,
  Plus,
  Settings,
} from 'lucide-react';
import { NavLink, useNavigate } from 'react-router-dom';

import { useCallsStore } from '@/features/calls/callsStore';
import { useNotesStore } from '@/features/history/notesStore';
import { useRecordingActions } from '@/features/recorder/useRecordingSession';
import { useUiStore } from '@/store/uiStore';

import styles from './Sidebar.module.css';

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? `${styles.navItem}` : styles.navItem;

export default function Sidebar() {
  const navigate = useNavigate();
  const sidebarOpen = useUiStore((state) => state.sidebarOpen);
  const closeSidebar = useUiStore((state) => state.closeSidebar);
  const openSettings = useUiStore((state) => state.openSettings);
  const notesCount = useNotesStore((state) => state.notes.length);
  const callsCount = useCallsStore((state) => state.calls.length);
  const { clearDraft } = useRecordingActions();

  return (
    <aside
      className={
        sidebarOpen ? `${styles.sidebar} ${styles.open}` : styles.sidebar
      }
    >
      <div className={styles.brand}>
        {/* 品牌标记跟随导航项用线性图标，实心方块会压过 14px 的应用名。 */}
        <AudioLines size={16} className={styles.brandMark} aria-hidden="true" />
        <span>拾语</span>
      </div>

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
        <Kbd className={styles.shortcut}>⌘N</Kbd>
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
    </aside>
  );
}
