package desktop

import (
	"errors"
	"fmt"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// overlayWidth/Height 是隐藏态胶囊的原生窗口尺寸。窗口比胶囊
	// （320×56）大一圈，四周留白给 CSS box-shadow——macOS 关掉原生
	// 阴影后，阴影全靠网页绘制，窗口紧贴胶囊会把阴影裁掉。
	overlayWidth  = 360
	overlayHeight = 72
	// overlayBottomInset 让胶囊悬在 Dock/任务栏上方，不贴屏幕底边。
	overlayBottomInset = 48
	// overlayHideGrace 是会话结束后的隐藏宽限：圆内 Check/X 闪示
	// 约 320ms，留 400ms 再隐藏，宽限内连按热键不会被旧定时器关掉。
	overlayHideGrace = 400 * time.Millisecond
)

// overlayTargetBounds 把胶囊放到屏幕工作区底部居中，再钳制回工作区，
// 多屏或分辨率变化时不会落到 Dock/菜单栏后面。
func overlayTargetBounds(area application.Rect) application.Rect {
	rect := application.Rect{
		X:      area.X + (area.Width-overlayWidth)/2,
		Y:      area.Y + area.Height - overlayHeight - overlayBottomInset,
		Width:  overlayWidth,
		Height: overlayHeight,
	}
	return clampRectToWorkArea(rect, area)
}

func (c *Controller) overlayRect() application.Rect {
	return overlayTargetBounds(c.bubbleWorkArea())
}

// showOverlay 在隐藏态按热键时叫出底部胶囊。全链路禁止 Focus()：
// 自动粘贴的目标是「粘贴那一刻的前台应用」，overlay 一旦抢焦点，
// 结果就会粘回拾语自己而不是用户原来的编辑器。
func (c *Controller) showOverlay() {
	if c.window == nil {
		return
	}
	if err := c.applyModeImmediately(ModeOverlay); err != nil {
		return
	}
	c.window.Show()
	// macOS Show() 会按 Mac.DisableShadow 重置阴影，首次显示还可能
	// 覆盖 SetPosition 的落点；显示后补一次 chrome 与胶囊矩形。
	enableBubbleHoverTracking(c.window.NativeWindow())
	c.syncBubbleHoverTracking()
	c.applyBubbleChrome(c.window)
	c.setWindowBounds(c.overlayRect())
}

// SetBubbleHidden 切换「仅保留托盘」的隐藏态并持久化。空闲时隐藏后
// 悬浮球与主窗口都不显示，全局热键触发底部胶囊；恢复时回到悬浮球形态。
// 若隐藏时会话仍在进行（录音/整理），不整个藏掉窗口，而是切到底部胶囊
// 继续展示波形与取消，结束后自动收回仅托盘，保证中途隐藏仍可用。
// 无托盘的平台（Linux）拒绝隐藏，否则隐藏后没有任何恢复入口。
func (c *Controller) SetBubbleHidden(hidden bool) error {
	if hidden && !traySupported() {
		return errors.New("hiding the bubble requires a system tray on this platform")
	}
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	if c.app != nil {
		if err := c.app.SetBubbleHidden(hidden); err != nil {
			return err
		}
	}
	if hidden {
		c.mu.RLock()
		status := c.sessionStatus
		mode := c.mode
		c.mu.RUnlock()
		if status != "idle" {
			// 录音/整理途中隐藏：整个藏掉窗口会看不到波形也没法取消。
			// 改叫出底部胶囊继续展示会话，结束后由隐藏定时器自动收回
			// 仅托盘。先停在途动画，避免它把胶囊 frame 拽回去；从主窗口
			// 离开时记住位置，便于之后恢复主窗口。
			c.cancelTransition()
			if mode == ModeMain && c.window != nil {
				c.rememberMainBounds(c.window.Bounds())
			}
			c.showOverlay()
		} else {
			// 空闲时整体隐藏窗口，只剩托盘。HideWindow 会忽略动画途中
			// 的请求，与右键菜单「隐藏悬浮球」的既有语义一致。
			if err := c.HideWindow(); err != nil {
				return err
			}
		}
	} else {
		// 恢复显示：先让窗口以当前形态出现，再切回悬浮球。隐藏期间
		// 窗口不可见，直接 SetMode 会在不可见窗口上播动画。
		if c.window != nil && !c.window.IsVisible() {
			c.window.Show()
			c.applyWindowChrome()
			c.positionBubbleIfNeeded()
		}
		if err := c.SetMode(ModeBubble); err != nil {
			return err
		}
	}
	// 两条路径都刷新状态：前端设置开关与托盘菜单的互斥启用都读它。
	// HideWindow 自身不发 desktop:state，隐藏路径必须在这里补一次。
	c.emitState()
	return nil
}

// SetSessionStatus 由前端把录音会话状态同步给宿主：回到 idle 后安排
// 胶囊隐藏。托盘图标是静态的、不随录音变化（macOS 系统自带麦克风使用
// 中指示）。状态白名单与前端 sessionStore 一致，非法值直接拒绝，避免
// 定时器被未知状态触发。
func (c *Controller) SetSessionStatus(status string) error {
	switch status {
	case "idle", "arming", "recording", "processing":
	default:
		return fmt.Errorf("unknown session status %q", status)
	}
	c.mu.Lock()
	c.sessionStatus = status
	// 任何状态变化都先停掉旧的隐藏定时器：新会话开始（arming/
	// recording）时不能让它把刚叫出的胶囊关掉；回到 idle 再重排。
	if c.overlayHideTimer != nil {
		c.overlayHideTimer.Stop()
		c.overlayHideTimer = nil
	}
	if status == "idle" {
		c.overlayHideTimer = time.AfterFunc(overlayHideGrace, c.hideOverlayIfIdle)
	}
	c.mu.Unlock()
	return nil
}

// hideOverlayIfIdle 是宽限定时器的回调：复核状态仍是 idle、窗口仍
// 处于 overlay 且没有动画在途，才真正隐藏。宽限内用户连按热键开始
// 新会话时，状态已不是 idle，这里直接放弃，不会误关新胶囊。
func (c *Controller) hideOverlayIfIdle() {
	c.mu.RLock()
	status := c.sessionStatus
	mode := c.mode
	transitioning := c.transitioning
	c.mu.RUnlock()
	if status != "idle" || mode != ModeOverlay || transitioning {
		return
	}
	_ = c.HideWindow()
}
