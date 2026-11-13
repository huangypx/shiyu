// Package desktop 负责与宿主窗口相关、刻意放在模型与
// 录音服务之外的行为。它由应用入口绑定到 Wails，
// 并可按操作系统替换实现。
package desktop

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/huangypx/shiyu/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	ModeMain   = "main"
	ModeBubble = "bubble"

	mainWidth         = 1000
	mainHeight        = 820
	mainMinWidth      = 640
	mainMinHeight     = 640
	bubbleSize        = 56
	bubbleBottomInset = 20
	focusSettleDelay  = 150 * time.Millisecond
)

// State 刻意保持精简且易于 JSON 序列化：原生控制器掌管真实窗口，
// React 外壳只管自己的视觉状态。
type State struct {
	Mode             string `json:"mode"`
	CloseRequested   bool   `json:"closeRequested"`
	Hotkey           string `json:"hotkey"`
	HotkeyRegistered bool   `json:"hotkeyRegistered"`
	HotkeyReason     string `json:"hotkeyReason,omitempty"`
	AutoPaste        bool   `json:"autoPaste"`
	KeepBubbleOnTop  bool   `json:"keepBubbleOnTop"`
	RestoreClipboard bool   `json:"restoreClipboard"`
	CanInjectText    bool   `json:"canInjectText"`
	// Platform 和 Backdrop 让 React 外壳选择标题栏尺寸和画布样式；
	// Backdrop 只是 CSS 提示，不再安装原生材质视图。
	Platform string `json:"platform"`
	Backdrop string `json:"backdrop"`
}

// RecordingHotkey 记住按键时的窗口模式和输入框，供录音界面就绪后领取。
type RecordingHotkey struct {
	Mode   string `json:"mode"`
	Target string `json:"target"`
}

// Controller 持有唯一的 Wails v3 窗口，并在主窗口与浮动球之间
// 切换它的尺寸、置顶和 macOS chrome。右键菜单由系统原生菜单
// 负责（见 menu.go），不再需要放大窗口来容纳弹层。
type Controller struct {
	app       *backend.App
	desktop   *application.App
	window    *application.WebviewWindow
	clipboard textClipboard

	clipboardMu       sync.Mutex
	clipboardRevision uint64

	mu             sync.RWMutex
	layoutMu       sync.Mutex
	hotkeyMu       sync.Mutex
	startupMu      sync.Mutex
	closeMu        sync.Mutex
	closePending   bool
	quitting       bool
	bubbleWidth    int
	bubbleHeight   int
	bubbleActive   bool
	mode           string
	modeEpoch      uint64
	lastMainBounds application.Rect
	shrinkCancel   chan struct{}
	reduceMotion   bool
	hotkey         *hotkeyRegistration
	pendingHotkeys []RecordingHotkey
	transcribing   bool
	reason         string
	started        bool
	targetWindow   string
	// cancelItem 是浮动球右键菜单里的「取消这段转写」。菜单由
	// RegisterBubbleMenu 创建，控制器只负责按录音状态切换可用性。
	cancelItem *application.MenuItem
}

type point struct {
	X int
	Y int
}

func NewController(app *backend.App, desktop *application.App, window *application.WebviewWindow) *Controller {
	c := &Controller{
		app:     app,
		desktop: desktop,
		window:  window,
		mode:    ModeMain,
	}
	if desktop != nil && desktop.Clipboard != nil {
		c.clipboard = desktop.Clipboard
	}
	return c
}

// ServiceStartup 由 Wails 在应用启动时调用：注册快捷键、准备
// 首击补丁，并在用户选择了「以悬浮球启动」时先切到浮动模式。
func (c *Controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	c.mu.Lock()
	c.started = true
	c.mu.Unlock()

	// 原生 chrome 和首击补丁必须在窗口第一次显示前准备好；
	// 其他应用在前台时，浮动球仍然要能响应第一次点击。
	enableFirstMouseClick()

	if c.desktop != nil {
		// 登录启动后即注册快捷键。隐藏的 WebView 可能要到第一次录音时才完成加载。
		c.desktop.Event.OnApplicationEvent(events.Common.ApplicationStarted, func(*application.ApplicationEvent) {
			c.refreshHotkey()
			c.emitState()
		})
	}
	if c.window != nil {
		lostFocus := events.Common.WindowLostFocus
		if runtime.GOOS == "windows" {
			// 子控件交接键盘焦点也会触发 WindowKillFocus。这里只关心顶层窗口失活。
			lostFocus = events.Windows.WindowInactive
		}
		c.window.OnWindowEvent(lostFocus, func(*application.WindowEvent) {
			c.scheduleBackgroundCheck()
		})
		c.window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
			c.mu.RLock()
			quitting := c.quitting
			c.mu.RUnlock()
			if !quitting {
				event.Cancel()
				go func() { _ = c.RequestClose() }()
			}
		})
		c.window.OnWindowEvent(events.Common.WindowMinimise, func(*application.WindowEvent) {
			if c.window.IsMinimised() {
				_ = c.SetMode(ModeBubble)
			}
		})
		// 系统最小化后窗口坐标可能已移出屏幕，正常移动和缩放结束时先留存。
		c.window.OnWindowEvent(events.Common.WindowDidMove, c.trackMainBounds)
		c.window.OnWindowEvent(events.Common.WindowDidResize, c.trackMainBounds)
		// NativeWindow() 要等平台窗口真正创建后才可用。运行时
		// 就绪后按当前模式补一次 chrome，覆盖「以球启动」和
		// 首次显示时窗口尚未创建的情况。
		c.window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
			c.refreshHotkey()
			c.emitState()
			// 启动时屏幕缓存可能还没就绪，等 WebView 运行时准备好后
			// 再按保存位置放一次浮动球。
			c.syncBubbleAfterStartup()
			c.scheduleBackgroundCheck()
		})
	} else {
		c.refreshHotkey()
	}

	if c.app != nil {
		cfg := c.app.GetDesktopConfig()
		if c.desktop != nil && runtime.GOOS == "windows" && cfg.LaunchAtLogin {
			if err := setLaunchAtLogin(true); err != nil {
				log.Printf("configure launch at login: %v", err)
			}
		}
		if BackgroundStartup(cfg.StartInBubble, os.Args[1:]) {
			if err := c.SetMode(ModeBubble); err != nil {
				return err
			}
		}
	}
	return nil
}

func (c *Controller) ServiceShutdown() error {
	// 拖拽可能在没有干净 mouse-up 的情况下结束，退出前再存一次。
	c.mu.Lock()
	c.quitting = true
	c.cancelShrinkLocked()
	old := c.hotkey
	c.hotkey = nil
	c.mu.Unlock()
	// 退出可能发生在原生主线程，不能等待正在向该线程提交的窗口或快捷键操作。
	if c.layoutMu.TryLock() {
		_ = c.persistBubblePositionLocked(false)
		c.layoutMu.Unlock()
	}
	c.mu.Lock()
	c.started = false
	c.mu.Unlock()
	old.Stop()
	return nil
}

func (c *Controller) GetState() State {
	c.mu.RLock()
	mode := c.mode
	closeRequested := c.closePending
	registration := c.hotkey
	reason := c.reason
	c.mu.RUnlock()

	var cfg backend.DesktopConfig
	if c.app != nil {
		cfg = c.app.GetDesktopConfig()
	}
	state := State{
		Mode:             mode,
		CloseRequested:   closeRequested,
		Hotkey:           cfg.Hotkey,
		AutoPaste:        cfg.AutoPaste,
		KeepBubbleOnTop:  cfg.KeepBubbleOnTop,
		RestoreClipboard: cfg.RestoreClipboard,
		CanInjectText:    canPasteCurrentCursor(),
		Platform:         runtime.GOOS,
		Backdrop:         platformBackdropKind(),
	}
	if registration != nil {
		state.HotkeyRegistered = registration.Available()
		state.HotkeyReason = registration.Reason()
	} else {
		state.HotkeyReason = reason
	}
	return state
}

func (c *Controller) SetMode(mode string) error {
	if mode == ModeMain {
		return c.ShowMainWindow()
	}
	if mode != ModeBubble {
		return fmt.Errorf("unknown desktop mode %q", mode)
	}
	if err := c.ensureRuntime(); err != nil {
		return err
	}

	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	return c.setModeLocked(mode)
}

func (c *Controller) setModeLocked(mode string) error {
	window := c.window
	if mode == ModeMain && window.IsMinimised() {
		window.UnMinimise()
	}
	// 全屏切换过程中改窗口样式或尺寸会让 AppKit 进入不一致状态；
	// 先退出全屏，等系统完成动画再继续。
	if window.IsFullscreen() {
		window.UnFullscreen()
		for attempt := 0; attempt < 20 && window.IsFullscreen(); attempt++ {
			time.Sleep(25 * time.Millisecond)
		}
	}

	// 先写模式再改窗口：WindowRuntimeReady 回调可能在尺寸/样式
	// 调用之间插入，回调按当前模式补 chrome，不能读到旧模式。
	c.mu.Lock()
	previousMode := c.mode
	wasShrinking := c.cancelShrinkLocked()
	c.mode = mode
	c.modeEpoch++
	if mode == ModeBubble {
		c.closePending = false
	}
	c.mu.Unlock()

	if mode == ModeBubble {
		if previousMode != ModeBubble {
			if !wasShrinking && window.NativeWindow() != nil && !window.IsMinimised() {
				c.rememberMainBounds(window.Bounds())
			}
			c.bubbleActive = false
			if window.NativeWindow() != nil {
				hideBubbleWindow(window)
			}
		}
		c.applyBubbleChrome(window)
		window.SetMaxSize(0, 0)
		window.SetMinSize(bubbleSize, bubbleSize)
		window.SetResizable(false)
		if previousMode != ModeBubble {
			c.bubbleWidth, c.bubbleHeight = bubbleSize, bubbleSize
		}
		c.positionBubble()
	} else if previousMode != ModeMain || wasShrinking {
		target := c.restoreMainTarget()
		c.applyMainChrome(window)
		window.SetResizable(true)
		window.SetMaxSize(0, 0)
		window.SetMinSize(mainMinWidth, mainMinHeight)
		setNativeWindowBounds(window, target)
		window.SetAlwaysOnTop(false)
	}

	c.emitState()
	return nil
}

func (c *Controller) scheduleBackgroundCheck() {
	c.mu.RLock()
	epoch := c.modeEpoch
	c.mu.RUnlock()
	time.AfterFunc(focusSettleDelay, func() { c.collapseInactiveMain(epoch) })
}

func (c *Controller) collapseInactiveMain(epoch uint64) {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	eligible := c.started && !c.quitting && !c.closePending && c.mode == ModeMain && c.modeEpoch == epoch
	c.mu.RUnlock()
	if eligible && c.window != nil && c.window.IsVisible() && !mainWindowInForeground(c.window) {
		_ = c.setModeLocked(ModeBubble)
	}
}

func (c *Controller) ToggleMode() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	mode := c.mode
	reduceMotion := c.reduceMotion
	busy := c.shrinkCancel != nil || c.closePending || c.quitting
	c.mu.RUnlock()
	if busy {
		return nil
	}
	if mode == ModeBubble {
		return c.showMainWindowLocked()
	}
	window := c.window
	if !reduceMotion && window.IsVisible() && !window.IsFullscreen() &&
		!window.IsMaximised() && !window.IsMinimised() && mainWindowInForeground(window) {
		from := window.Bounds()
		if target, ok := c.targetBubbleBounds(bubbleSize, bubbleSize); ok && from.Width > 0 && from.Height > 0 {
			c.beginShrink(from, target)
			return nil
		}
	}
	return c.setModeLocked(ModeBubble)
}

func (c *Controller) ShowMainWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	return c.showMainWindowLocked()
}

func (c *Controller) showMainWindowLocked() error {
	c.mu.RLock()
	fromBubble := c.mode == ModeBubble && !c.reduceMotion
	c.mu.RUnlock()
	if fromBubble && c.window.IsVisible() && !c.window.IsMinimised() {
		c.emitTransition(transitionExpand, c.window.Bounds(), c.restoreMainTarget(), expandLeadIn)
	}
	if err := c.setModeLocked(ModeMain); err != nil {
		return err
	}
	c.window.Show().Focus()
	c.applyMainChrome(c.window)
	return nil
}

func (c *Controller) HideWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.SetBubbleActivity(false)
	return nil
}

// MinimiseWindow 将主窗口转入后台，后续录音仍可由全局快捷键触发。
func (c *Controller) MinimiseWindow() error {
	if err := c.ensureMainMode(); err != nil {
		return err
	}
	return c.SetMode(ModeBubble)
}

// ToggleMaximiseWindow 支撑 Windows/Linux 的自绘标题栏按钮。
func (c *Controller) ToggleMaximiseWindow() error {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	if err := c.ensureMainMode(); err != nil {
		return err
	}
	c.mu.RLock()
	shrinking := c.shrinkCancel != nil
	c.mu.RUnlock()
	if shrinking {
		return nil
	}
	c.window.ToggleMaximise()
	return nil
}

// IsWindowMaximised 让 React 标题栏在最大化与还原图标之间
// 选择；控制器尚未启动时返回 false。
func (c *Controller) IsWindowMaximised() bool {
	if err := c.ensureMainMode(); err != nil {
		return false
	}
	return c.window.IsMaximised()
}

// SaveBubblePosition 持久化用户放下浮动圆圈的位置。渲染层
// 会在拖拽结束时上报；控制器在窗口隐藏或应用退出时也会
// 调用它，因为拖拽可能在没有干净 mouse-up 事件的情况下
// 结束。
func (c *Controller) SaveBubblePosition() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.mu.RLock()
	mode := c.mode
	c.mu.RUnlock()
	if mode != ModeBubble {
		return nil
	}
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	return c.persistBubblePositionLocked(true)
}

func (c *Controller) persistBubblePositionLocked(dragged bool) error {
	if c.app == nil || c.window == nil {
		return nil
	}
	c.mu.RLock()
	mode := c.mode
	started := c.started
	c.mu.RUnlock()
	if !started || mode != ModeBubble || !c.window.IsVisible() {
		return nil
	}
	if !dragged && (c.bubbleWidth != bubbleSize || c.bubbleHeight != bubbleSize) {
		return nil
	}

	// v3 的窗口坐标是绝对屏幕坐标。用户可能在拖拽后拔掉副屏，
	// 因此保存前按窗口中心所在屏幕的工作区再钳制一次。
	x, y := c.window.Position()
	// 胶囊向上展开。记录底部中央的球位，下一次内容变宽时仍对齐同一处。
	x += (c.bubbleWidth - bubbleSize) / 2
	y += c.bubbleHeight - bubbleSize
	center := point{X: x + bubbleSize/2, Y: y + bubbleSize/2}
	position := clampPoint(point{X: x, Y: y}, c.workAreaAt(center))

	cfg := c.app.GetDesktopConfig()
	if cfg.BubblePosition != nil &&
		cfg.BubblePosition.X == position.X &&
		cfg.BubblePosition.Y == position.Y {
		return nil
	}
	return backend.UpdateDesktopConfig(c.app, func(cfg *backend.DesktopConfig) {
		cfg.BubblePosition = &backend.BubblePosition{X: position.X, Y: position.Y}
	})
}

// ResizeBubble 让原生窗口跟随内容大小，收起后仍回到原来的球心。
func (c *Controller) ResizeBubble(width, height int) {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	inBubble := c.mode == ModeBubble
	c.mu.RUnlock()
	if !inBubble || c.window == nil {
		return
	}
	width, height = clampInt(width, bubbleSize, 400), clampInt(height, bubbleSize, 240)
	if width != c.bubbleWidth || height != c.bubbleHeight {
		c.bubbleWidth, c.bubbleHeight = width, height
		c.positionBubble()
	}
}

// SetBubbleActivity 只改变浮动窗的显隐，迟到的定时器不能隐藏刚打开的主窗口。
func (c *Controller) SetBubbleActivity(visible bool) {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	inBubble := c.started && !c.quitting && c.mode == ModeBubble
	awaitingHotkey := len(c.pendingHotkeys) > 0
	c.mu.RUnlock()
	if !inBubble || c.window == nil || (!visible && awaitingHotkey) {
		return
	}
	c.bubbleActive = visible
	if visible && !c.window.IsVisible() {
		c.positionBubble()
		presentBubbleWindow(c.window, c.keepBubbleOnTop())
	} else if !visible && c.window.IsVisible() {
		_ = c.persistBubblePositionLocked(false)
		hideBubbleWindow(c.window)
	}
}

func (c *Controller) positionBubble() {
	if c.window == nil {
		return
	}
	if bounds, ok := c.targetBubbleBounds(c.bubbleWidth, c.bubbleHeight); ok {
		setNativeWindowBounds(c.window, bounds)
	} else {
		c.window.SetSize(c.bubbleWidth, c.bubbleHeight)
	}
}

func (c *Controller) targetBubbleBounds(width, height int) (application.Rect, bool) {
	screen := c.windowScreen()
	if screen == nil {
		return application.Rect{}, false
	}
	area := screen.WorkArea
	var anchor *point
	if c.app != nil {
		if saved := c.app.GetDesktopConfig().BubblePosition; saved != nil {
			savedPoint := point{X: saved.X, Y: saved.Y}
			if target := c.screenAt(savedPoint); target != nil {
				// 保存的位置仍在某块屏幕上，原样恢复。
				area = target.WorkArea
				anchor = &savedPoint
			}
		}
	}

	return bubbleTargetBounds(area, anchor, width, height), true
}

func bubbleBounds(anchor point, area application.Rect, width, height int) application.Rect {
	width, height = min(width, area.Width), min(height, area.Height)
	return application.Rect{
		X:     clampInt(anchor.X+(bubbleSize-width)/2, area.X, area.X+area.Width-width),
		Y:     clampInt(anchor.Y+bubbleSize-height, area.Y, area.Y+area.Height-height),
		Width: width, Height: height,
	}
}

// OpenSettings 展开主窗口，并请求渲染层打开偏好设置对话框，
// 对应浮动球右键菜单里的条目。
func (c *Controller) OpenSettings() error {
	if err := c.ShowMainWindow(); err != nil {
		return err
	}
	c.emitSettings()
	return nil
}

// attachCancelMenuItem 保存菜单项引用，供 SetTranscribing 更新。
func (c *Controller) attachCancelMenuItem(item *application.MenuItem) {
	c.mu.Lock()
	c.cancelItem = item
	c.mu.Unlock()
}

// requestCancelTranscription 把右键菜单的点击转成前端事件：录音
// 状态由 React 侧持有，Go 只负责转发这次意图。
func (c *Controller) requestCancelTranscription() {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:cancel-transcribe")
	}
}

// SetTranscribing 让菜单项在「没有进行中的录音」时置灰。原生菜单
// 每次弹出前都会按当前状态重建，因此这里改完下次弹出即可见。
func (c *Controller) SetTranscribing(active bool) error {
	c.mu.Lock()
	c.transcribing = active
	item := c.cancelItem
	c.mu.Unlock()
	if item != nil {
		item.SetEnabled(active)
	}
	return nil
}

func (c *Controller) emitState() {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:state", c.GetState())
	}
}

func (c *Controller) emitSettings() {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:settings")
	}
}

// Quit 通过 Wails 的应用管理器退出桌面进程。无边框窗口隐藏了
// 原生标题栏关闭按钮，因此需要暴露这个方法。
func (c *Controller) Quit() {
	c.mu.Lock()
	c.quitting = true
	c.cancelShrinkLocked()
	c.mu.Unlock()
	if c.desktop != nil {
		c.desktop.Quit()
	}
}

// CopyText 直接写系统剪贴板，不需要浏览器权限弹窗，
// 结果卡片和键盘快捷键都会用到它。
func (c *Controller) CopyText(text string) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("text is empty")
	}
	if c.clipboard == nil {
		return errors.New("desktop controller is not started")
	}
	c.clipboardMu.Lock()
	defer c.clipboardMu.Unlock()
	return c.writeClipboardLocked(text)
}

type textClipboard interface {
	Text() (string, bool)
	SetText(string) bool
}

func (c *Controller) writeClipboardLocked(text string) error {
	if !c.clipboard.SetText(text) {
		return errors.New("set clipboard failed")
	}
	// 复制和自动粘贴即使写入同一段文字，也代表两次独立的用户操作。
	c.clipboardRevision++
	return nil
}

func (c *Controller) restoreClipboardLocked(revision uint64, pasted, previous string) {
	if revision != c.clipboardRevision {
		return
	}
	if current, ok := c.clipboard.Text(); ok && current == pasted {
		_ = c.writeClipboardLocked(previous)
	}
}

// PasteText 把文本输入到当前应用：先更新剪贴板，
// 再用当前平台最稳妥的方式发送粘贴按键。
// 没有可用的宿主注入器时，文本会留在剪贴板里，
// 用户仍能手动粘贴，结果不会丢。
func (c *Controller) PasteText(text string) error {
	c.mu.RLock()
	target := c.targetWindow
	c.mu.RUnlock()
	return c.pasteTo(text, target, "")
}

// FocusedBubbleInput 只记录当前可编辑控件的标识，供录音完成时复核。
func (c *Controller) FocusedBubbleInput() string {
	c.mu.RLock()
	inBubble := c.mode == ModeBubble
	c.mu.RUnlock()
	if !inBubble {
		return ""
	}
	return focusedInputTarget()
}

// PasteBubbleResult 仅在原输入框仍有焦点时粘贴，否则交给浮动球展示。
func (c *Controller) PasteBubbleResult(text, target string) (bool, error) {
	if target == "" || c.app == nil || !c.app.GetDesktopConfig().AutoPaste {
		return false, nil
	}
	err := c.pasteTo(text, "", target)
	if errors.Is(err, errInputChanged) {
		return false, nil
	}
	return err == nil, err
}

// FinishForegroundRecording 在投递前核对原生窗口，避免失焦事件尚未到达时误粘贴。
func (c *Controller) FinishForegroundRecording(text string, autoPaste bool) (bool, error) {
	if err := c.ensureRuntime(); err != nil {
		return false, err
	}
	c.layoutMu.Lock()
	c.mu.RLock()
	mode, pending := c.mode, c.closePending || c.quitting
	shrinking := c.shrinkCancel != nil
	c.mu.RUnlock()
	if pending || mode != ModeMain {
		c.layoutMu.Unlock()
		return false, nil
	}
	if shrinking || c.window.IsMinimised() || !c.window.IsVisible() || !mainWindowInForeground(c.window) {
		err := c.setModeLocked(ModeBubble)
		c.layoutMu.Unlock()
		return false, err
	}
	c.layoutMu.Unlock()
	if autoPaste {
		return true, c.PasteText(text)
	}
	return true, nil
}

var errInputChanged = errors.New("the original input no longer has keyboard focus")

func (c *Controller) pasteTo(text, targetWindow, expectedInput string) error {
	restore := c.app != nil && c.app.GetDesktopConfig().RestoreClipboard
	return c.pasteWithClipboard(text, expectedInput, restore, func() error {
		return pasteCurrentCursor(targetWindow, expectedInput)
	})
}

func (c *Controller) pasteWithClipboard(text, expectedInput string, restore bool, inject func() error) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("text is empty")
	}
	if c.clipboard == nil {
		return errors.New("desktop controller is not started")
	}
	c.clipboardMu.Lock()
	defer c.clipboardMu.Unlock()
	var previous string
	var havePrevious bool
	if restore || expectedInput != "" {
		previous, havePrevious = c.clipboard.Text()
	}
	if expectedInput != "" && c.FocusedBubbleInput() != expectedInput {
		return errInputChanged
	}
	if err := c.writeClipboardLocked(text); err != nil {
		return err
	}
	revision := c.clipboardRevision
	if err := inject(); err != nil {
		if errors.Is(err, errInputChanged) && havePrevious {
			c.restoreClipboardLocked(revision, text, previous)
		}
		return err
	}
	if restore && havePrevious {
		time.AfterFunc(1500*time.Millisecond, func() {
			c.clipboardMu.Lock()
			defer c.clipboardMu.Unlock()
			c.restoreClipboardLocked(revision, text, previous)
		})
	}
	return nil
}

func (c *Controller) ConfigureHotkey(hotkey string) error {
	if c.app == nil {
		return errors.New("backend app is not configured")
	}
	if err := backend.UpdateDesktopConfig(c.app, func(cfg *backend.DesktopConfig) {
		cfg.Hotkey = strings.TrimSpace(hotkey)
	}); err != nil {
		return err
	}
	c.refreshHotkey()
	c.emitState()
	return nil
}

func (c *Controller) refreshHotkey() {
	c.hotkeyMu.Lock()
	defer c.hotkeyMu.Unlock()
	if c.app == nil {
		return
	}
	key := c.app.GetDesktopConfig().Hotkey
	c.mu.Lock()
	if !c.started || c.quitting || (c.hotkey.Available() && c.hotkey.key == key) {
		c.mu.Unlock()
		return
	}
	old := c.hotkey
	c.hotkey = nil
	c.mu.Unlock()
	old.Stop()
	registration, err := registerHotkey(c.desktop, key, c.handleHotkey)
	c.mu.Lock()
	if c.quitting || !c.started {
		c.mu.Unlock()
		registration.Stop()
		return
	}
	if err != nil {
		c.reason = err.Error()
	} else {
		c.hotkey = registration
		c.reason = ""
	}
	c.mu.Unlock()
}

func (c *Controller) handleHotkey() {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	mode, blocked := c.mode, !c.started || c.quitting || c.closePending
	active := c.transcribing
	shrinking := c.shrinkCancel != nil
	c.mu.RUnlock()
	if blocked || c.window == nil {
		return
	}
	background := shrinking || mode == ModeBubble || !c.window.IsVisible() || c.window.IsMinimised() || !mainWindowInForeground(c.window)
	var input string
	if background && !active {
		// 在浮动窗出现前取得焦点，避免把刚显示的胶囊误认为最初的输入目标。
		input = focusedInputTarget()
	}
	if mode == ModeMain && background {
		if err := c.setModeLocked(ModeBubble); err != nil {
			return
		}
		mode = ModeBubble
	}
	if mode == ModeMain {
		target := activeWindowID()
		c.mu.Lock()
		c.targetWindow = target
		c.mu.Unlock()
	}
	c.mu.Lock()
	c.pendingHotkeys = append(c.pendingHotkeys, RecordingHotkey{Mode: mode, Target: input})
	c.mu.Unlock()
	if mode == ModeBubble && !c.window.IsVisible() {
		c.bubbleActive = true
		c.positionBubble()
		presentBubbleWindow(c.window, c.keepBubbleOnTop())
	}
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:hotkey", mode)
	}
}

// TakeRecordingHotkeys 让第一次按键可以先于前端订阅到达，多次通知只领取一次。
func (c *Controller) TakeRecordingHotkeys() []RecordingHotkey {
	c.mu.Lock()
	defer c.mu.Unlock()
	keys := c.pendingHotkeys
	c.pendingHotkeys = nil
	return keys
}

func (c *Controller) ensureRuntime() error {
	c.mu.RLock()
	started := c.started
	window := c.window
	c.mu.RUnlock()
	if !started || window == nil {
		return errors.New("desktop controller is not started")
	}
	return nil
}

func (c *Controller) ensureMainMode() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.mu.RLock()
	mode := c.mode
	c.mu.RUnlock()
	if mode != ModeMain {
		return errors.New("window controls are only available in main mode")
	}
	return nil
}

func (c *Controller) keepBubbleOnTop() bool {
	if c.app == nil {
		return true
	}
	return c.app.GetDesktopConfig().KeepBubbleOnTop
}

func (c *Controller) syncBubbleAfterStartup() {
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	mode := c.mode
	shrinking := c.shrinkCancel != nil
	c.mu.RUnlock()
	if shrinking {
		return
	}
	if mode == ModeBubble {
		c.applyBubbleChrome(c.window)
		c.positionBubble()
		if c.bubbleActive {
			presentBubbleWindow(c.window, c.keepBubbleOnTop())
		} else {
			hideBubbleWindow(c.window)
		}
	} else {
		c.applyMainChrome(c.window)
		if c.window.IsVisible() && !c.window.IsMinimised() {
			c.rememberMainBounds(c.window.Bounds())
		}
	}
}

func (c *Controller) applyBubbleChrome(window *application.WebviewWindow) {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		setBubbleChrome(window.NativeWindow())
	}
}

func (c *Controller) applyMainChrome(window *application.WebviewWindow) {
	if runtime.GOOS == "darwin" || runtime.GOOS == "windows" {
		restoreMainChrome(window.NativeWindow())
	}
}

// windowScreen 返回窗口当前所在的屏幕；Wails 还没创建原生窗口时
// 退回到主屏，避免位置计算直接失败。
func (c *Controller) windowScreen() *application.Screen {
	if c.window != nil {
		if screen, err := c.window.GetScreen(); err == nil && screen != nil {
			return screen
		}
	}
	if c.desktop != nil {
		return c.desktop.Screen.GetPrimary()
	}
	return nil
}

// screenAt 返回包含给定绝对屏幕坐标的屏幕。v3 的 Screen.WorkArea
// 已经是逻辑像素的绝对矩形，因此这里不再维护 v2 的屏幕相对坐标假设。
func (c *Controller) screenAt(position point) *application.Screen {
	if c.desktop == nil {
		return nil
	}
	for _, screen := range c.desktop.Screen.GetAll() {
		if screen != nil && rectContains(screen.WorkArea, position) {
			return screen
		}
	}
	return nil
}

func (c *Controller) workAreaAt(position point) application.Rect {
	if screen := c.screenAt(position); screen != nil {
		return screen.WorkArea
	}
	if screen := c.windowScreen(); screen != nil {
		return screen.WorkArea
	}
	// 没有屏幕信息时退回常见笔记本尺寸，行为与 v2 一致。
	return application.Rect{Width: 1440, Height: 900}
}

func rectContains(area application.Rect, position point) bool {
	return position.X >= area.X &&
		position.Y >= area.Y &&
		position.X < area.X+area.Width &&
		position.Y < area.Y+area.Height
}

func clampPoint(position point, area application.Rect) point {
	return point{
		X: clampInt(position.X, area.X, area.X+area.Width-bubbleSize),
		Y: clampInt(position.Y, area.Y, area.Y+area.Height-bubbleSize),
	}
}

func clampInt(value, low, high int) int {
	if high < low {
		return low
	}
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}
