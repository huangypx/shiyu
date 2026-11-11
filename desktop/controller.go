// Package desktop 负责与宿主窗口相关、刻意放在模型与
// 录音服务之外的行为。它由应用入口绑定到 Wails，
// 并可按操作系统替换实现。
package desktop

import (
	"context"
	"errors"
	"fmt"
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

	mainWidth     = 1280
	mainHeight    = 820
	mainMinWidth  = 980
	mainMinHeight = 640
	bubbleSize    = 92

	// 首次进入浮动模式时，球停在当前屏幕工作区右下角，
	// 与边缘留出一点呼吸空间。
	bubbleRightInset  = 28
	bubbleBottomInset = 56
)

// State 刻意保持精简且易于 JSON 序列化：原生控制器掌管真实窗口，
// React 外壳只管自己的视觉状态。
type State struct {
	Mode             string `json:"mode"`
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

// Controller 持有唯一的 Wails v3 窗口，并在主窗口与浮动球之间
// 切换它的尺寸、置顶和 macOS chrome。右键菜单由系统原生菜单
// 负责（见 menu.go），不再需要放大窗口来容纳弹层。
type Controller struct {
	app     *backend.App
	desktop *application.App
	window  *application.WebviewWindow

	mu           sync.RWMutex
	mode         string
	hotkey       *hotkeyRegistration
	reason       string
	started      bool
	targetWindow string
	// cancelItem 是浮动球右键菜单里的「取消这段转写」。菜单由
	// RegisterBubbleMenu 创建，控制器只负责按录音状态切换可用性。
	cancelItem *application.MenuItem
}

type point struct {
	X int
	Y int
}

func NewController(app *backend.App, desktop *application.App, window *application.WebviewWindow) *Controller {
	return &Controller{
		app:     app,
		desktop: desktop,
		window:  window,
		mode:    ModeMain,
	}
}

// ServiceStartup 由 Wails 在应用启动时调用：注册快捷键、准备
// 首击补丁，并在用户选择了「以悬浮球启动」时先切到 92x92。
func (c *Controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	c.mu.Lock()
	c.started = true
	c.mu.Unlock()

	// 原生 chrome 和首击补丁必须在窗口第一次显示前准备好；
	// 其他应用在前台时，浮动球仍然要能响应第一次点击。
	enableFirstMouseClick()
	c.refreshHotkey()

	if c.window != nil {
		// NativeWindow() 要等平台窗口真正创建后才可用。运行时
		// 就绪后按当前模式补一次 chrome，覆盖「以球启动」和
		// 首次显示时窗口尚未创建的情况。
		c.window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
			c.applyWindowChrome()
			// 启动时屏幕缓存可能还没就绪，等 WebView 运行时准备好后
			// 再按保存位置放一次浮动球。
			c.positionBubbleIfNeeded()
		})
	}

	if c.app != nil && c.app.GetDesktopConfig().StartInBubble {
		if err := c.SetMode(ModeBubble); err != nil {
			return err
		}
		c.showWindow()
	}
	return nil
}

func (c *Controller) ServiceShutdown() error {
	// 拖拽可能在没有干净 mouse-up 的情况下结束，退出前再存一次。
	_ = c.persistBubblePosition()

	c.mu.Lock()
	defer c.mu.Unlock()
	if c.hotkey != nil {
		c.hotkey.Stop()
		c.hotkey = nil
	}
	return nil
}

func (c *Controller) GetState() State {
	c.mu.RLock()
	mode := c.mode
	registration := c.hotkey
	reason := c.reason
	c.mu.RUnlock()

	var cfg backend.DesktopConfig
	if c.app != nil {
		cfg = c.app.GetDesktopConfig()
	}
	state := State{
		Mode:             mode,
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
	if mode != ModeMain && mode != ModeBubble {
		return fmt.Errorf("unknown desktop mode %q", mode)
	}
	if err := c.ensureRuntime(); err != nil {
		return err
	}

	window := c.window
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
	c.mode = mode
	c.mu.Unlock()

	if mode == ModeBubble {
		c.applyBubbleChrome(window)
		window.SetMaxSize(bubbleSize, bubbleSize)
		window.SetMinSize(bubbleSize, bubbleSize)
		window.SetSize(bubbleSize, bubbleSize)
		window.SetAlwaysOnTop(c.keepBubbleOnTop())
		c.positionBubble()
	} else {
		// 先记下球所在的屏幕，再放大：主窗口应该在这块屏幕上居中，
		// 而不是像 v3 的 Center() 那样固定回到主屏。
		screen, _ := window.GetScreen()
		c.applyMainChrome(window)
		window.SetMaxSize(0, 0)
		window.SetMinSize(mainMinWidth, mainMinHeight)
		window.SetSize(mainWidth, mainHeight)
		window.SetAlwaysOnTop(false)
		if screen != nil {
			window.SetScreen(screen)
		} else {
			window.Center()
		}
	}

	c.emitState()
	return nil
}

func (c *Controller) ToggleMode() error {
	c.mu.RLock()
	mode := c.mode
	c.mu.RUnlock()
	if mode == ModeBubble {
		return c.SetMode(ModeMain)
	}
	return c.SetMode(ModeBubble)
}

func (c *Controller) ShowMainWindow() error {
	if err := c.SetMode(ModeMain); err != nil {
		return err
	}
	c.showWindow()
	return nil
}

func (c *Controller) HideWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	_ = c.persistBubblePosition()
	c.window.Hide()
	return nil
}

// MinimiseWindow 支撑 Windows/Linux 的自绘标题栏按钮；
// macOS 窗口改用系统自带的黄色交通灯。
func (c *Controller) MinimiseWindow() error {
	if err := c.ensureMainMode(); err != nil {
		return err
	}
	c.window.Minimise()
	return nil
}

// ToggleMaximiseWindow 支撑 Windows/Linux 的自绘标题栏按钮。
func (c *Controller) ToggleMaximiseWindow() error {
	if err := c.ensureMainMode(); err != nil {
		return err
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
	return c.persistBubblePosition()
}

func (c *Controller) persistBubblePosition() error {
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

	// v3 的窗口坐标是绝对屏幕坐标。用户可能在拖拽后拔掉副屏，
	// 因此保存前按窗口中心所在屏幕的工作区再钳制一次。
	x, y := c.window.Position()
	center := point{X: x + bubbleSize/2, Y: y + bubbleSize/2}
	position := clampPoint(point{X: x, Y: y}, c.workAreaAt(center))

	cfg := c.app.GetDesktopConfig()
	if cfg.BubblePosition != nil &&
		cfg.BubblePosition.X == position.X &&
		cfg.BubblePosition.Y == position.Y {
		return nil
	}
	cfg.BubblePosition = &backend.BubblePosition{X: position.X, Y: position.Y}
	return c.app.SaveDesktopConfig(cfg)
}

func (c *Controller) positionBubble() {
	if c.window == nil {
		return
	}
	screen := c.windowScreen()
	if screen == nil {
		return
	}
	area := screen.WorkArea
	position := point{
		X: area.X + area.Width - bubbleSize - bubbleRightInset,
		Y: area.Y + area.Height - bubbleSize - bubbleBottomInset,
	}

	if c.app != nil {
		if saved := c.app.GetDesktopConfig().BubblePosition; saved != nil {
			savedPoint := point{X: saved.X, Y: saved.Y}
			if target := c.screenAt(savedPoint); target != nil {
				// 保存的位置仍在某块屏幕上，原样恢复。
				area = target.WorkArea
				position = savedPoint
			}
		}
	}

	position = clampPoint(position, area)
	c.window.SetPosition(position.X, position.Y)
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
	c.mu.RLock()
	item := c.cancelItem
	c.mu.RUnlock()
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

func (c *Controller) emitHotkey() {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:hotkey")
	}
}

// Quit 通过 Wails 的应用管理器退出桌面进程。无边框窗口隐藏了
// 原生标题栏关闭按钮，因此需要暴露这个方法。
func (c *Controller) Quit() {
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
	if c.desktop == nil {
		return errors.New("desktop controller is not started")
	}
	if !c.desktop.Clipboard.SetText(text) {
		return errors.New("set clipboard failed")
	}
	return nil
}

// PasteText 把文本输入到当前应用：先更新剪贴板，
// 再用当前平台最稳妥的方式发送粘贴按键。
// 没有可用的宿主注入器时，文本会留在剪贴板里，
// 用户仍能手动粘贴，结果不会丢。
func (c *Controller) PasteText(text string) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("text is empty")
	}
	if c.desktop == nil {
		return errors.New("desktop controller is not started")
	}
	cfg := backend.DesktopConfig{}
	if c.app != nil {
		cfg = c.app.GetDesktopConfig()
	}
	var previous string
	var havePrevious bool
	if cfg.RestoreClipboard {
		previous, havePrevious = c.desktop.Clipboard.Text()
	}
	if !c.desktop.Clipboard.SetText(text) {
		return errors.New("set clipboard failed")
	}
	c.mu.RLock()
	targetWindow := c.targetWindow
	c.mu.RUnlock()
	if err := pasteCurrentCursor(targetWindow); err != nil {
		return err
	}
	if cfg.RestoreClipboard && havePrevious {
		go func() {
			time.Sleep(1500 * time.Millisecond)
			c.desktop.Clipboard.SetText(previous)
		}()
	}
	return nil
}

func (c *Controller) ConfigureHotkey(hotkey string) error {
	if c.app == nil {
		return errors.New("backend app is not configured")
	}
	cfg := c.app.GetDesktopConfig()
	cfg.Hotkey = strings.TrimSpace(hotkey)
	if err := c.app.SaveDesktopConfig(cfg); err != nil {
		return err
	}
	c.refreshHotkey()
	return nil
}

func (c *Controller) refreshHotkey() {
	c.mu.Lock()
	if c.hotkey != nil {
		c.hotkey.Stop()
		c.hotkey = nil
	}
	started := c.started
	c.mu.Unlock()
	if !started || c.app == nil {
		return
	}
	cfg := c.app.GetDesktopConfig()
	registration, err := registerHotkey(cfg.Hotkey, func() {
		// 在 Wails 窗口收到任何结果事件前，先记下当时
		// 拥有焦点的应用；自动粘贴正是靠它回到发起
		// 快捷键的编辑器或聊天应用。
		if target := activeWindowID(); target != "" {
			c.mu.Lock()
			c.targetWindow = target
			c.mu.Unlock()
		}
		if c.window != nil {
			c.showWindow()
			c.window.Focus()
		}
		c.emitHotkey()
	})
	c.mu.Lock()
	defer c.mu.Unlock()
	if err != nil {
		c.reason = err.Error()
		return
	}
	c.hotkey = registration
	c.reason = ""
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

// showWindow 在显示后重新应用 chrome：Wails 的 macOS show()
// 会按 Mac.DisableShadow 重置窗口阴影，把浮动球的透明边缘又画出来。
func (c *Controller) showWindow() {
	if c.window == nil {
		return
	}
	c.window.Show()
	c.applyWindowChrome()

	// 首次显示时 AppKit 会把窗口放到初始位置，可能覆盖 SetMode 里
	// 的 SetPosition。显示完成后再按保存的位置放一次。
	c.positionBubbleIfNeeded()
}

func (c *Controller) positionBubbleIfNeeded() {
	c.mu.RLock()
	mode := c.mode
	c.mu.RUnlock()
	if mode == ModeBubble {
		c.positionBubble()
	}
}

func (c *Controller) applyWindowChrome() {
	c.mu.RLock()
	mode := c.mode
	window := c.window
	c.mu.RUnlock()
	if window == nil {
		return
	}
	if mode == ModeBubble {
		c.applyBubbleChrome(window)
		return
	}
	c.applyMainChrome(window)
}

func (c *Controller) applyBubbleChrome(window *application.WebviewWindow) {
	if runtime.GOOS == "darwin" {
		setBubbleChrome(window.NativeWindow())
	}
}

func (c *Controller) applyMainChrome(window *application.WebviewWindow) {
	if runtime.GOOS == "darwin" {
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
