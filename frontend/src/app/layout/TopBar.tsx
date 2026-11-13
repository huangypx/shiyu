import { DropdownMenu, Tooltip } from '@radix-ui/themes';
import {
  Activity,
  Ellipsis,
  FilePlus2,
  History,
  LoaderCircle,
  Mic,
  Minimize2,
  Settings,
  Square,
  X,
} from 'lucide-react';
import { useCallback, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';

import BrandMark from '@/components/BrandMark';
import { useAppShortcuts } from '@/features/desktop/useAppShortcuts';
import { useTitlebarDoubleClick } from '@/features/desktop/useTitlebarDoubleClick';
import { useWindowActions } from '@/features/desktop/useWindowActions';
import { useWindowTransitionStore } from '@/features/desktop/windowTransitionStore';
import { useMicLevelVar } from '@/features/recorder/useMicLevel';
import {
  useProcessingTimer,
  useRecordingActions,
} from '@/features/recorder/useRecordingSession';
import { Waveform } from '@/features/recorder/Waveform';
import { formatShortcut } from '@/lib/shortcut';
import { useDesktopStore } from '@/store/desktopStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

import styles from './TopBar.module.css';
import WindowControls from './WindowControls';

export default function TopBar() {
  const navigate = useNavigate();
  const platform = useDesktopStore((state) => state.runtime.platform);
  const hotkey = useDesktopStore((state) => state.runtime.hotkey);
  const status = useSessionStore((state) => state.status);
  const stage = useSessionStore((state) => state.stage);
  const elapsed = useSessionStore((state) =>
    Math.floor(state.elapsedMs / 1000),
  );
  const openSettings = useUiStore((state) => state.openSettings);
  const { clearDraft, toggleRecording, cancelTranscription } =
    useRecordingActions();
  const { toggleWindowMode } = useWindowActions();
  const transitioning = useWindowTransitionStore(
    (state) => state.transition !== null,
  );
  const onTitlebarDoubleClick = useTitlebarDoubleClick();
  const processing = status === 'processing';
  const toolbar = useRef<HTMLElement>(null);
  useMicLevelVar(toolbar);
  useProcessingTimer(processing);

  const newRecord = useCallback(() => {
    if (status !== 'idle') return;
    clearDraft();
    void navigate('/');
  }, [clearDraft, navigate, status]);
  useAppShortcuts(newRecord);

  const processingLabel = stage === 'organize' ? '整理中' : '转写中';
  const recordLabel = {
    idle: '开始录音',
    arming: '取消开启麦克风',
    recording: '结束录音',
    processing: processingLabel,
  }[status];
  const statusLabel = {
    idle: '',
    arming: '开启麦克风',
    recording: '录音中',
    processing: processingLabel,
  }[status];

  return (
    <>
      <header className={styles.titlebar} onDoubleClick={onTitlebarDoubleClick}>
        <Link to="/" className={styles.brand} aria-label="拾语，返回编辑器">
          <BrandMark size={23} />
          <span>拾语</span>
        </Link>
        <WindowControls platform={platform} />
      </header>

      <nav ref={toolbar} className={styles.toolbar} aria-label="记录工具">
        <Tooltip content={hotkey ? `${recordLabel} (${hotkey})` : recordLabel}>
          <button
            type="button"
            className={styles.mic}
            data-state={status}
            aria-label={recordLabel}
            disabled={processing}
            onClick={() => {
              void navigate('/');
              void toggleRecording();
            }}
          >
            {processing || status === 'arming' ? (
              <LoaderCircle className="spin" />
            ) : status === 'recording' ? (
              <Square size={18} fill="currentColor" />
            ) : (
              <Mic />
            )}
          </button>
        </Tooltip>
        {status !== 'idle' && (
          <div className={styles.status}>
            {status === 'recording' && <Waveform active />}
            <span role="status">{statusLabel}</span>
            {processing && <span className={styles.elapsed}>{elapsed}s</span>}
            {status !== 'arming' && (
              <Tooltip content="取消这段转写">
                <button
                  type="button"
                  aria-label="取消这段转写"
                  onClick={cancelTranscription}
                >
                  <X size={16} />
                </button>
              </Tooltip>
            )}
          </div>
        )}
        <Tooltip content={`新建记录 (${formatShortcut(platform, 'N')})`}>
          <button
            type="button"
            className={styles.action}
            aria-label="新建记录"
            onClick={newRecord}
            disabled={status !== 'idle'}
          >
            <FilePlus2 />
          </button>
        </Tooltip>
        <Tooltip content="历史记录">
          <NavLink
            to="/history"
            className={styles.action}
            aria-label="历史记录"
          >
            <History />
          </NavLink>
        </Tooltip>
        <span className={styles.separator} aria-hidden="true" />
        <Tooltip content={`偏好设置 (${formatShortcut(platform, ',')})`}>
          <button
            type="button"
            className={styles.action}
            aria-label="偏好设置"
            onClick={openSettings}
          >
            <Settings />
          </button>
        </Tooltip>

        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            <button
              type="button"
              className={`${styles.action} ${styles.more}`}
              aria-label="更多操作"
              title="更多操作"
            >
              <Ellipsis size={20} />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Content align="end" size="2" variant="soft">
            <DropdownMenu.Item onSelect={() => void navigate('/calls')}>
              <Activity size={15} /> 调用记录
            </DropdownMenu.Item>
            {platform !== 'web' && (
              <DropdownMenu.Item
                disabled={transitioning}
                onSelect={() => void toggleWindowMode()}
              >
                <Minimize2 size={15} /> 收进悬浮球
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      </nav>
    </>
  );
}
