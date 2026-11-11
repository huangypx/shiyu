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

	mainWidth     = 1000
	mainHeight    = 820
	mainMinWidth  = 640
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

	// 窗口切换是一次异步动画：transitioning 期间 SetMode 直接
	// 忽略新请求，避免两次动画互相追着改 frame。
	transitioning    bool
	transitionCancel chan struct{}
	// lastMainBounds 只在内存里记住收起前的主窗口位置，重启后
	// 回到默认尺寸，不引入新的配置字段。
	lastMainBounds    application.Rect
	hasLastMainBounds bool
	reduceMotion      bool
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
			// 动画中途的 RuntimeReady 不能按当前模式重刷 chrome，
			// 否则会把刚切好的 borderless 或位置覆盖掉。
			if c.isTransitioning() {
				return
			}
			c.applyWindowChrome()
			// 启动时屏幕缓存可能还没就绪，等 WebView 运行时准备好后
			// 再按保存位置放一次浮动球。
			c.positionBubbleIfNeeded()
		})
	}

	if c.app != nil && c.app.GetDesktopConfig().StartInBubble {
		// 启动路径不能播动画：窗口还没显示，前端也还没准备好遮罩。
		if err := c.applyModeImmediately(ModeBubble); err != nil {
			return err
		}
		c.showWindow()
	}
	return nil
}

func (c *Controller) ServiceShutdown() error {
	// 先停掉在途动画，再保存位置：展开途中退出时不能把中间的
	// 窗口坐标写成悬浮球位置。
	c.cancelTransition()
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

	c.mu.RLock()
	current := c.mode
	transitioning := c.transitioning
	reduceMotion := c.reduceMotion
	c.mu.RUnlock()

	// 动画期间的重复请求直接忽略：顶栏已禁用，右键菜单也可能
	// 在窗口还没落定时被触发，排队只会让 frame 来回抖。
	if transitioning || current == mode {
		return nil
	}
	if reduceMotion {
		return c.applyModeImmediately(mode)
	}
	return c.beginTransition(mode)
}

// SetReduceMotion 由前端把 prefers-reduced-motion 同步过来。原生
// 窗口动画读不到 CSS 媒体查询，只能由宿主代为关掉。
func (c *Controller) SetReduceMotion(enabled bool) error {
	c.mu.Lock()
	c.reduceMotion = enabled
	c.mu.Unlock()
	return nil
}

func (c *Controller) isTransitioning() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.transitioning
}

// cancelTransition 让在途动画在下一帧退出。关闭通道而不是等
// goroutine 自己结束，退出流程才不会被一帧 frame 卡住。
func (c *Controller) cancelTransition() {
	c.mu.Lock()
	if c.transitionCancel != nil {
		close(c.transitionCancel)
		c.transitionCancel = nil
	}
	c.transitioning = false
	c.mu.Unlock()
}

// beginTransition 负责收起/展开的公共编排：先占住 transitioning，
// 再计算两端矩形、切 chrome、放宽尺寸约束，最后交给动画协程。
func (c *Controller) beginTransition(mode string) error {
	window := c.window

	c.mu.Lock()
	if c.transitioning || c.mode == mode {
		c.mu.Unlock()
		return nil
	}
	c.transitioning = true
	cancel := make(chan struct{})
	c.transitionCancel = cancel
	c.mu.Unlock()

	direction := transitionShrink
	anchor := anchorBottomRight
	var from, to application.Rect
	var mainBounds application.Rect
	rememberMain := false

	if mode == ModeBubble {
		// 先记下主窗口位置；它必须是切换 chrome 之前的值。
		mainBounds = window.Bounds()
		rememberMain = mainBounds.Width >= mainMinWidth &&
			mainBounds.Height >= mainMinHeight
		// borderless 可能带走标题栏高度，动画起点以切换后的
		// 真实 frame 为准，否则第一帧会跳。
		c.applyBubbleChrome(window)
		from = window.Bounds()
		to = c.bubbleRect()
		anchor = anchorCorner(
			to.X+to.Width/2,
			to.Y+to.Height/2,
			mainBounds.X+mainBounds.Width/2,
			mainBounds.Y+mainBounds.Height/2,
		)
		// 收缩过程中保持可见；最终置顶跟随用户配置。
		window.SetAlwaysOnTop(true)
	} else {
		direction = transitionExpand
		from = window.Bounds()
		to = c.restoreMainTarget()
		// 展开不画水滴；anchor 保留默认值，事件载荷保持一致。
		// 悬浮球淡出期间仍置顶，落定后 applySettledMode 恢复普通层级。
		window.SetAlwaysOnTop(true)
	}

	// 只有收起需要逐帧改 frame；展开是等球淡出后直接回到记忆
	// 的主窗口位置。动画期间不能保留 92px 的 max 或 640px 的
	// min，否则中间帧会被系统夹住。
	if mode == ModeBubble {
		window.SetMaxSize(0, 0)
		window.SetMinSize(0, 0)
	}

	if from.Width <= 0 || from.Height <= 0 || to.Width <= 0 || to.Height <= 0 {
		// 原生窗口还没就绪或屏幕信息缺失：退回无动画路径，
		// 至少保证模式和尺寸最终一致。
		c.resetTransition(cancel)
		return c.applyModeImmediately(mode)
	}

	if rememberMain {
		c.rememberMainBounds(mainBounds)
	}

	// 动画开始前可能已经退出（关闭应用）；不要给已经取消的
	// 切换再发事件或启动协程。
	c.mu.RLock()
	stillCurrent := c.transitionCancel == cancel
	c.mu.RUnlock()
	if !stillCurrent {
		return nil
	}

	duration := shrinkDuration
	var ease func(float64) float64 = easeInOutCubic
	eventDuration := shrinkDuration
	if mode == ModeMain {
		// 展开没有逐帧动画：这 160ms 只用来让悬浮球淡出，
		// 然后把窗口直接放回记忆的位置。
		duration = 0
		ease = nil
		eventDuration = expandLeadIn
	}
	c.emitTransition(transitionEvent{
		Direction:  direction,
		DurationMs: int(eventDuration / time.Millisecond),
		Anchor:     anchor,
		From:       boundsFromRect(from),
		To:         boundsFromRect(to),
	})
	go c.runTransition(mode, from, to, duration, ease, cancel)
	return nil
}

// runTransition 先等前端挂好遮罩、悬浮球淡出。收起逐帧推进
// 窗口 frame，展开直接把窗口落到记忆位置。defer 保证无论完成、
// 取消还是异常都不会把 transitioning 永久留在 true。
func (c *Controller) runTransition(
	mode string,
	from, to application.Rect,
	duration time.Duration,
	ease func(float64) float64,
	cancel chan struct{},
) {
	defer func() {
		c.mu.Lock()
		// 只清自己这一次的标记；cancelTransition 已经清过时
		// 不能顺手把之后可能开始的新切换也关掉。
		if c.transitionCancel == cancel {
			c.transitionCancel = nil
			c.transitioning = false
		}
		c.mu.Unlock()
	}()

	leadIn := shrinkLeadIn
	if mode == ModeMain {
		leadIn = expandLeadIn
	}
	select {
	case <-time.After(leadIn):
	case <-cancel:
		return
	}

	// 展开只等悬浮球淡出，随后直接把原生窗口放到记忆的位置；
	// 窗口在屏幕上移动的过程不可见，用户看到的是主界面在
	// 原来的位置淡入，而不是悬浮球飞过去。
	if mode == ModeMain {
		c.applySettledMode(mode, to)
		return
	}

	if !animateWindowBounds(from, to, duration, ease, c.setWindowBounds, cancel) {
		return
	}
	c.applySettledMode(mode, to)
}

// applySettledMode 把窗口落到最终状态并通知 React 换路由。chrome、
// 尺寸约束和 bounds 的顺序不能反：styleMask 切换可能改变 frame，
// 所以最后一次 setWindowBounds 必须在恢复 chrome 之后。展开时先
// 移窗口再恢复 chrome，避免交通灯在球窗位置闪一帧。
func (c *Controller) applySettledMode(mode string, bounds application.Rect) {
	window := c.window
	if window == nil {
		return
	}
	// 先把约束放开再落 bounds：收起的 92px max 或展开的 640px min
	// 如果还生效，会在窗口移动到目标位置前先夹一帧。
	window.SetMaxSize(0, 0)
	window.SetMinSize(0, 0)
	if mode == ModeBubble {
		c.applyBubbleChrome(window)
		c.setWindowBounds(bounds)
	} else {
		// 展开时先把透明窗口移到主窗口位置，再恢复 titled chrome；
		// 反过来会让交通灯在 92px 的球窗位置闪一下。chrome 切换
		// 可能改 frame，所以最后再落一次 bounds。
		c.setWindowBounds(bounds)
		c.applyMainChrome(window)
		c.setWindowBounds(bounds)
	}
	if mode == ModeBubble {
		window.SetMaxSize(bubbleSize, bubbleSize)
		window.SetMinSize(bubbleSize, bubbleSize)
		window.SetAlwaysOnTop(c.keepBubbleOnTop())
	} else {
		window.SetMaxSize(0, 0)
		window.SetMinSize(mainMinWidth, mainMinHeight)
		window.SetAlwaysOnTop(false)
	}

	c.mu.Lock()
	c.mode = mode
	c.mu.Unlock()
	if mode == ModeMain {
		// 从悬浮球展开时应用可能不在前台；落定后主动取得焦点，
		// 否则窗口虽然恢复在原位，仍会被其他应用盖住。
		window.Focus()
	}
	c.emitState()
}

// applyModeImmediately 是启动、减少动效和异常回退共用的无动画
// 路径：直接切 chrome、约束和 bounds，然后发一次状态。
func (c *Controller) applyModeImmediately(mode string) error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	window := c.window
	if mode == ModeBubble {
		c.mu.RLock()
		current := c.mode
		c.mu.RUnlock()
		if current == ModeMain {
			c.rememberMainBounds(window.Bounds())
		}
		c.applySettledMode(mode, c.bubbleRect())
		return nil
	}
	c.applySettledMode(mode, c.restoreMainTarget())
	return nil
}

func (c *Controller) resetTransition(cancel chan struct{}) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.transitionCancel == cancel {
		c.transitionCancel = nil
		c.transitioning = false
	}
}

func (c *Controller) rememberMainBounds(bounds application.Rect) {
	if bounds.Width < mainMinWidth || bounds.Height < mainMinHeight {
		return
	}
	c.mu.Lock()
	c.lastMainBounds = bounds
	c.hasLastMainBounds = true
	c.mu.Unlock()
}

// bubbleRect 计算悬浮球目标。保存位置仍落在某块屏幕上时沿用那块
// 屏幕和坐标，否则回到当前屏幕的右下角。
func (c *Controller) bubbleRect() application.Rect {
	area := c.bubbleWorkArea()
	var saved *point
	if c.app != nil {
		if position := c.app.GetDesktopConfig().BubblePosition; position != nil {
			candidate := point{X: position.X, Y: position.Y}
			if screen := c.screenAt(candidate); screen != nil {
				area = screen.WorkArea
				saved = &candidate
			}
		}
	}
	return bubbleTargetBounds(area, saved)
}

func (c *Controller) bubbleWorkArea() application.Rect {
	if screen := c.windowScreen(); screen != nil {
		return screen.WorkArea
	}
	// 没有屏幕信息时退回常见笔记本尺寸，与 v2 一致。
	return application.Rect{Width: 1440, Height: 900}
}

// restoreMainTarget 返回收起前记住的主窗口矩形。屏幕布局变了
// 或没有记录时，在悬浮球所在屏幕居中默认尺寸。
func (c *Controller) restoreMainTarget() application.Rect {
	c.mu.RLock()
	last := c.lastMainBounds
	hasLast := c.hasLastMainBounds
	c.mu.RUnlock()

	if hasLast {
		center := point{X: last.X + last.Width/2, Y: last.Y + last.Height/2}
		if screen := c.screenAt(center); screen != nil {
			return clampRectToWorkArea(last, screen.WorkArea)
		}
	}

	area := c.bubbleWorkArea()
	return clampRectToWorkArea(centeredRect(area, mainWidth, mainHeight), area)
}

func (c *Controller) setWindowBounds(bounds application.Rect) {
	if c.window == nil {
		return
	}
	setNativeWindowBounds(c.window, bounds)
}

func (c *Controller) emitTransition(event transitionEvent) {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:transition", event)
	}
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
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	// 隐藏状态下展开时，先让窗口以悬浮球形态出现并聚焦，再开始
	// 长大；否则动画可能在一个不可见的窗口上播放。
	if !c.window.IsVisible() {
		c.window.Show()
		c.applyWindowChrome()
		c.positionBubbleIfNeeded()
	}
	c.window.Focus()
	return c.SetMode(ModeMain)
}

func (c *Controller) HideWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	// 动画途中隐藏会把窗口停在中间尺寸，下一次展开就找不到
	// 正确的悬浮球矩形；直接忽略这次请求。
	if c.isTransitioning() {
		return nil
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
	transitioning := c.transitioning
	c.mu.RUnlock()
	if mode != ModeBubble || transitioning {
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
	transitioning := c.transitioning
	c.mu.RUnlock()
	// 展开途中窗口正在移动，此时保存会覆盖掉用户原来拖到的
	// 悬浮球坐标；退出流程会先 cancelTransition 再走到这里。
	if !started || transitioning || mode != ModeBubble || !c.window.IsVisible() {
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
	c.setWindowBounds(c.bubbleRect())
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
	transitioning := c.transitioning
	c.mu.RUnlock()
	// 动画期间窗口正在改尺寸，系统最小化/最大化会把中间 frame
	// 写进 AppKit 的还原栈；等落定后再允许。
	if transitioning {
		return errors.New("window controls are unavailable during a transition")
	}
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
	// 动画途中热键也可能把窗口叫出来；这时不能按旧模式重刷
	// chrome 或位置，否则会把收缩/展开的中间 frame 拽回去。
	if c.isTransitioning() {
		return
	}
	c.applyWindowChrome()

	// 首次显示时 AppKit 会把窗口放到初始位置，可能覆盖 SetPosition
	// 的落点。显示完成后再按保存的位置放一次。
	c.positionBubbleIfNeeded()
}

func (c *Controller) positionBubbleIfNeeded() {
	c.mu.RLock()
	mode := c.mode
	transitioning := c.transitioning
	c.mu.RUnlock()
	if mode == ModeBubble && !transitioning {
		c.positionBubble()
	}
}

func (c *Controller) applyWindowChrome() {
	c.mu.RLock()
	mode := c.mode
	window := c.window
	transitioning := c.transitioning
	c.mu.RUnlock()
	if window == nil || transitioning {
		return
	}
	if mode == ModeBubble {
		c.applyBubbleChrome(window)
		return
	}
	c.applyMainChrome(window)
}

// applyBubbleChrome 把窗口切成浮动球形态。非 macOS 平台过去是空实现，
// Windows 现在要在这里收掉 DWM 的玻璃边框（否则球后面会露出方框）；
// 其他平台的实现仍然是空函数。
func (c *Controller) applyBubbleChrome(window *application.WebviewWindow) {
	setBubbleChrome(window.NativeWindow())
}

func (c *Controller) applyMainChrome(window *application.WebviewWindow) {
	restoreMainChrome(window.NativeWindow())
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
