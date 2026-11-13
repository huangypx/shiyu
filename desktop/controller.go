// Package desktop 负责宿主窗口、全局热键与录音会话编排。main、
// bubble、overlay 是三个独立窗口，麦克风采集与转写流水线都在 Go
// 内，窗口只渲染会话状态。
package desktop

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/huangypx/shiyu/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

const (
	// overlayHideGrace 是会话结束后的隐藏宽限：胶囊里的 Check/X
	// 约 320ms，留 400ms 再销毁窗口，宽限内连按热键可以复用同一个
	// 胶囊。
	overlayHideGrace = 400 * time.Millisecond

	// mainRevealFallback 是主窗口前端迟迟没有报告首帧时的兜底
	// 显示时间。正常路径由前端挂载后调用 MarkMainWindowReady，
	// 宽限只是防止脚本异常把主窗口永久留在隐藏状态。
	mainRevealFallback = 3 * time.Second
)

// State 是桌面外壳的全局状态。窗口角色与是否只剩托盘分开表达：
// Mode 是当前主可见面，BubbleHidden 决定恢复入口。
type State struct {
	Mode             string `json:"mode"`
	Hotkey           string `json:"hotkey"`
	HotkeyRegistered bool   `json:"hotkeyRegistered"`
	HotkeyReason     string `json:"hotkeyReason,omitempty"`
	AutoPaste        bool   `json:"autoPaste"`
	KeepBubbleOnTop  bool   `json:"keepBubbleOnTop"`
	RestoreClipboard bool   `json:"restoreClipboard"`
	CanInjectText    bool   `json:"canInjectText"`
	BubbleHidden     bool   `json:"bubbleHidden"`
	CloseRequested   bool   `json:"closeRequested"`
	Platform         string `json:"platform"`
	Backdrop         string `json:"backdrop"`
}

// SessionMetrics 镜像前端 CallMetrics，字段名与现有历史记录一致。
type SessionMetrics struct {
	ASR *backend.CallRecord `json:"asr,omitempty"`
	LLM *backend.CallRecord `json:"llm,omitempty"`
}

// SessionState 是所有窗口共享的唯一会话状态。录音中的实时文本由
// Go 流水线写入，三个窗口只读；窗口销毁不会带走它。
type SessionState struct {
	Status         string         `json:"status"`
	Stage          string         `json:"stage,omitempty"`
	Transcript     string         `json:"transcript"`
	Organized      string         `json:"organized"`
	Metrics        SessionMetrics `json:"metrics"`
	StageStartedAt int64          `json:"stageStartedAt,omitempty"`
	Revision       uint64         `json:"revision"`
	Host           string         `json:"host,omitempty"`
}

// Controller 持有窗口编排、热键和会话状态。windows 里最多同时存在
// 一个可见面（main/bubble）和一个 overlay 胶囊；麦克风采集与转写
// 流水线都在 Go 内，窗口只是视图。
type Controller struct {
	app     *backend.App
	desktop *application.App

	mu      sync.RWMutex
	started bool
	// windowMu 串行化窗口创建/销毁，避免两个入口同时建出同名窗口。
	windowMu sync.Mutex

	visible string
	windows map[string]*application.WebviewWindow

	mainBounds    application.Rect
	hasMainBounds bool
	// mainReady 表示当前主窗口的前端已经完成首次提交。未就绪时
	// 窗口保持隐藏，等 MarkMainWindowReady 到达后再显示，避免
	// macOS 先画出原生交通灯、WebView 还是空白。
	mainReady bool
	// mainShowFocus 记住这次显示是否需要聚焦，首帧就绪时补上。
	mainShowFocus bool
	// mainRevealTimer 是前端未报告首帧时的兜底显示定时器。
	mainRevealTimer *time.Timer

	session          SessionState
	overlayHideTimer *time.Timer
	// starting 覆盖「开始录音的命令已发出、状态还没变成 recording」
	// 的窗口期：隐藏定时器不能在此时把胶囊销毁。
	starting bool
	// sessionMu 串行化开始/停止/整理的状态迁移；sessionToken 用原子
	// 值，音频线程只读它来判断自己的回调是否已经过期。
	sessionMu        sync.Mutex
	sessionToken     atomic.Uint64
	capture          *nativeCapture
	historyID        string
	sessionStartedAt time.Time
	pendingSettings  bool

	hotkey       *hotkeyRegistration
	reason       string
	targetWindow string
	tray         *tray

	closePending bool
	closeMu      sync.Mutex
	quitting     bool
}

func NewController(app *backend.App, desktop *application.App) *Controller {
	return &Controller{
		app:     app,
		desktop: desktop,
		visible: ModeMain,
		windows: make(map[string]*application.WebviewWindow),
		session: SessionState{Status: "idle", Host: ModeOverlay},
	}
}

// ServiceStartup 装配托盘与热键，并按用户偏好创建初始窗口。
// 选择「仅保留托盘」时不创建任何窗口，首次热键再拉起 overlay。
func (c *Controller) ServiceStartup(_ context.Context, _ application.ServiceOptions) error {
	c.mu.Lock()
	c.started = true
	c.mu.Unlock()

	enableFirstMouseClick()
	c.refreshHotkey()
	if c.desktop != nil {
		// 流式 ASR 的增量文本由 Go 直接写进会话状态，main/bubble
		// 只消费 desktop:session，不再各自订阅服务商事件。
		c.desktop.Event.On(backend.EventASRPartial, func(event *application.CustomEvent) {
			c.handleASRPartial(event.Data)
		})
	}
	// 托盘在 ServiceStartup 装配：SystemTray.New() 的原生 run 由 Wails
	// 推迟到 app.Run 之后，这里创建正合适，绝不手动 Run()。
	c.tray = newTray(c)

	cfg := backend.DesktopConfig{}
	if c.app != nil {
		cfg = c.app.GetDesktopConfig()
	}
	switch InitialMode(cfg) {
	case ModeHidden:
		// 只留托盘：不建任何窗口，但要记下「当前没有可见面」，
		// 让 Dock 图标也在启动阶段就收起来。
		c.setVisible("")
	case ModeBubble:
		c.showBubbleInternal(true)
	default:
		c.showMainInternal(true)
	}
	c.emitState()
	return nil
}

func (c *Controller) ServiceShutdown() error {
	_ = c.persistBubblePosition()

	c.sessionMu.Lock()
	capture := c.capture
	c.capture = nil
	c.sessionMu.Unlock()
	if capture != nil {
		capture.Stop()
	}
	if c.app != nil {
		_, _ = c.app.CancelRecording()
	}

	c.mu.Lock()
	if c.overlayHideTimer != nil {
		c.overlayHideTimer.Stop()
		c.overlayHideTimer = nil
	}
	if c.mainRevealTimer != nil {
		c.mainRevealTimer.Stop()
		c.mainRevealTimer = nil
	}
	if c.hotkey != nil {
		c.hotkey.Stop()
		c.hotkey = nil
	}
	tray := c.tray
	c.tray = nil
	c.quitting = true
	c.mu.Unlock()

	if tray != nil {
		tray.destroy()
	}
	return nil
}

func (c *Controller) GetState() State {
	c.mu.RLock()
	visible := c.visible
	registration := c.hotkey
	reason := c.reason
	closePending := c.closePending
	c.mu.RUnlock()

	mode := normalizeMode(visible)
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
		BubbleHidden:     cfg.BubbleHidden,
		CloseRequested:   closePending,
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

func (c *Controller) GetSession() SessionState {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.session
}

// PublishSession 只接受空闲时的草稿编辑；录音/整理状态由 Controller
// 自己写，避免视图窗口把过期状态覆盖回后端。
func (c *Controller) PublishSession(state SessionState) error {
	switch state.Stage {
	case "", "transcribe", "organize":
	default:
		return fmt.Errorf("unknown session stage %q", state.Stage)
	}
	c.mu.Lock()
	if c.session.Status != "idle" {
		c.mu.Unlock()
		return errors.New("session is active")
	}
	next := c.session
	next.Stage = state.Stage
	next.Transcript = state.Transcript
	next.Organized = state.Organized
	next.Metrics = state.Metrics
	next.StageStartedAt = state.StageStartedAt
	c.mu.Unlock()
	c.publishSessionState(next)
	return nil
}

// publishSessionState 写入唯一会话状态并广播；调用方不持有 c.mu。
func (c *Controller) publishSessionState(state SessionState) {
	c.mu.Lock()
	state.Host = ModeOverlay
	state.Revision = c.session.Revision + 1
	c.session = state
	c.starting = false
	c.scheduleOverlayHide(state.Status)
	c.mu.Unlock()
	c.emitSessionState(state)
}

func (c *Controller) emitSessionState(state SessionState) {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:session", state)
	}
}

// scheduleOverlayHide 在会话回到 idle 后安排隐藏/销毁胶囊；新会话
// 开始时取消旧定时器。调用方必须持有 c.mu。
func (c *Controller) scheduleOverlayHide(next string) {
	if c.overlayHideTimer != nil {
		c.overlayHideTimer.Stop()
		c.overlayHideTimer = nil
	}
	if next != "idle" || c.windows[ModeOverlay] == nil {
		return
	}
	// 即使上一次也是 idle 也要排一次：麦克风启动失败时会直接
	// 回到 idle，胶囊必须自己消失，不能停在屏上。
	c.overlayHideTimer = time.AfterFunc(overlayHideGrace, c.hideOverlayIfIdle)
}

func (c *Controller) emitSession() {
	c.emitSessionState(c.GetSession())
}

// notify 把录音/转写结果以轻量事件发给当前可见窗口；主窗口显示
// Toast，悬浮球和胶囊退化成闪烁。
func (c *Controller) notify(message, tone string) {
	if c.desktop == nil {
		return
	}
	c.desktop.Event.Emit("desktop:notice", map[string]string{
		"message": message,
		"tone":    tone,
	})
}

// PublishMicLevel 把 Go 采集器的电平广播给可见窗口。波形和球的缩放
// 都读这个值，频率约 20Hz，不进 React 状态。
func (c *Controller) PublishMicLevel(level float64) {
	if c.desktop == nil {
		return
	}
	if level < 0 {
		level = 0
	}
	if level > 1 {
		level = 1
	}
	c.desktop.Event.Emit("desktop:mic-level", map[string]float64{"level": level})
}

// ToggleRecording 是热键和所有视图共用的入口。采集在 Go 内完成，
// 胶囊只负责显示；全程不 Focus 任何窗口。
func (c *Controller) ToggleRecording() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	// 先停掉空闲隐藏任务，再显示胶囊。starting 覆盖「胶囊已显示、
	// 状态还没变成 arming」的窗口期，避免隐藏定时器把它关掉。
	c.mu.Lock()
	if c.overlayHideTimer != nil {
		c.overlayHideTimer.Stop()
		c.overlayHideTimer = nil
	}
	if c.session.Status == "idle" {
		c.starting = true
	}
	c.mu.Unlock()
	c.showOverlayInternal()

	c.sessionMu.Lock()
	defer c.sessionMu.Unlock()
	c.mu.RLock()
	status := c.session.Status
	c.mu.RUnlock()

	switch status {
	case "processing":
		// 整理中不响应开始/结束，避免并发写同一段会话。
		c.mu.Lock()
		c.starting = false
		c.mu.Unlock()
		return nil
	case "arming":
		// 还在打开设备时再按一次就是取消，和旧交互一致。
		c.mu.Lock()
		c.starting = false
		c.mu.Unlock()
		token := c.sessionToken.Add(1)
		go c.cancelSession(token)
	case "recording":
		c.mu.Lock()
		c.starting = false
		c.mu.Unlock()
		token := c.sessionToken.Add(1)
		go c.stopSession(token)
	default:
		token := c.sessionToken.Add(1)
		c.mu.Lock()
		c.historyID = ""
		c.sessionStartedAt = time.Now()
		c.starting = true
		c.mu.Unlock()
		c.publishSessionState(SessionState{Status: "arming", Host: ModeOverlay})
		go c.startSession(token)
	}
	return nil
}

func (c *Controller) CancelTranscription() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.mu.RLock()
	active := c.session.Status != "idle"
	hasOverlay := c.windows[ModeOverlay] != nil
	c.mu.RUnlock()
	if !active && !hasOverlay {
		return nil
	}
	c.showOverlayInternal()
	token := c.sessionToken.Add(1)
	go c.cancelSession(token)
	return nil
}

// TakeMainCommands 返回主窗口挂载时需要补做的动作。目前只有
// 「从悬浮球打开设置」这一种。
func (c *Controller) TakeMainCommands() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.pendingSettings {
		return nil
	}
	c.pendingSettings = false
	return []string{"settings"}
}

// MarkMainWindowReady 由主窗口前端在首次提交后调用。主窗口创建时
// 先保持隐藏，等这里收到信号再 Show：否则 macOS 会先把原生交通灯
// 画出来，而 WKWebView 还没有任何内容。
func (c *Controller) MarkMainWindowReady() {
	c.revealMain(c.current(ModeMain))
}

// ShowMainWindow 销毁悬浮球并创建主窗口；录音仍在 Go 内继续。
func (c *Controller) ShowMainWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.showMainInternal(true)
	return nil
}

// EnterBubble 销毁主窗口并把可见面换成悬浮球。
func (c *Controller) EnterBubble() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.showBubbleInternal(true)
	return nil
}

// OpenSettings 展开主窗口并请求渲染层打开偏好设置。主窗口刚创建时
// 事件可能早于订阅，因此走 pendingSettings 由前端领取。
func (c *Controller) OpenSettings() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	hasMain := c.current(ModeMain) != nil
	if !hasMain {
		// 必须在创建窗口前登记：前端挂载后立刻会来领取命令。
		c.mu.Lock()
		c.pendingSettings = true
		c.mu.Unlock()
	}
	c.showMainInternal(true)
	if hasMain {
		c.emitSettings()
	}
	return nil
}

// SetBubbleHidden 切换「仅保留托盘」。会话进行中隐藏不会丢录音：
// 胶囊保持可见，等 idle 后由隐藏定时器销毁。
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
		c.rememberMainBounds(c.current(ModeMain))
		c.detachAndClose(ModeMain)
		c.detachAndClose(ModeBubble)
		if c.sessionActive() {
			// 录音/整理仍在进行：胶囊作为可见提示继续存在。
			c.showOverlayInternal()
			c.setVisible(ModeOverlay)
		} else {
			c.detachAndClose(ModeOverlay)
			c.setVisible("")
		}
	} else {
		// 恢复可见面。会话进行中时胶囊不销毁，继续采集。
		c.showBubbleInternal(true)
	}
	c.emitState()
	return nil
}

// HideWindow 只隐藏当前界面、不写偏好；Linux 没有托盘时悬浮球
// 右键菜单退回这里。
func (c *Controller) HideWindow() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.rememberMainBounds(c.current(ModeMain))
	c.detachAndClose(ModeMain)
	c.detachAndClose(ModeBubble)
	if c.sessionActive() {
		c.showOverlayInternal()
		c.setVisible(ModeOverlay)
	} else {
		c.detachAndClose(ModeOverlay)
		c.setVisible("")
	}
	c.emitState()
	return nil
}

// MinimiseWindow 支撑 Windows/Linux 的自绘标题栏按钮；
// macOS 窗口改用系统自带的黄色交通灯。
func (c *Controller) MinimiseWindow() error {
	window, err := c.mainWindow()
	if err != nil {
		return err
	}
	window.Minimise()
	return nil
}

// ToggleMaximiseWindow 支撑 Windows/Linux 的自绘标题栏按钮。
func (c *Controller) ToggleMaximiseWindow() error {
	window, err := c.mainWindow()
	if err != nil {
		return err
	}
	window.ToggleMaximise()
	return nil
}

// IsWindowMaximised 让 React 标题栏在最大化与还原图标之间选择。
func (c *Controller) IsWindowMaximised() bool {
	window := c.current(ModeMain)
	return window != nil && window.IsMaximised()
}

// SaveBubblePosition 持久化用户放下悬浮球的位置。拖拽结束、隐藏
// 或退出时都会调用它。
func (c *Controller) SaveBubblePosition() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	return c.persistBubblePosition()
}

// ApplyDesktopSettings 让已存在的悬浮球立即跟随「保持置顶」开关；
// 其余偏好在下一次创建窗口时生效。
func (c *Controller) ApplyDesktopSettings() error {
	if c.app == nil {
		return nil
	}
	window := c.current(ModeBubble)
	if window != nil {
		window.SetAlwaysOnTop(c.app.GetDesktopConfig().KeepBubbleOnTop)
	}
	return nil
}

// Quit 通过 Wails 的应用管理器退出桌面进程。
func (c *Controller) Quit() {
	c.mu.Lock()
	c.quitting = true
	c.mu.Unlock()
	if c.desktop != nil {
		c.desktop.Quit()
	}
}

// CopyText 直接写系统剪贴板，不需要浏览器权限弹窗。
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

// PasteText 把文本输入到当前应用：先更新剪贴板，再发送粘贴键。
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
		// 在窗口出现前记下当时拥有焦点的应用；自动粘贴靠它回到
		// 发起快捷键的编辑器或聊天应用。
		if target := activeWindowID(); target != "" {
			c.mu.Lock()
			c.targetWindow = target
			c.mu.Unlock()
		}
		_ = c.ToggleRecording()
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

func (c *Controller) onMainClosing(window *application.WebviewWindow, event *application.WindowEvent) {
	c.mu.RLock()
	quitting := c.quitting
	c.mu.RUnlock()
	if quitting {
		return
	}
	// 控制器收起主窗口时先从 windows 摘除，再延迟 Close；此时窗口
	// 已经不是当前主窗口，应当直接放行。这里用窗口身份而不是
	// “刚发出关闭”的瞬时标记：WindowClosing 由另一个 goroutine
	// 异步派发，标记可能在事件到达前就被清掉，导致收起时误弹关闭
	// 确认框。
	if c.isCurrentMainWindow(window) {
		event.Cancel()
		go func() { _ = c.RequestClose() }()
	}
}

// isCurrentMainWindow 判断窗口是否仍是当前主窗口。用户发起的关闭
// 只可能落在当前主窗口上；已被 detachAndClose 摘除的旧窗口是控制器
// 自己的延迟关闭，必须放行。
func (c *Controller) isCurrentMainWindow(window *application.WebviewWindow) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.windows[ModeMain] == window
}

func (c *Controller) showMainInternal(focus bool) {
	if window := c.current(ModeMain); window != nil {
		c.setVisible(ModeMain)
		c.showMainIfReady(window, focus)
		c.clearBubbleHidden()
		c.emitState()
		return
	}
	_ = c.persistBubblePosition()
	c.detachAndClose(ModeBubble)
	window := c.ensureWindow(ModeMain)
	if window == nil {
		return
	}
	c.setVisible(ModeMain)
	c.showMainIfReady(window, focus)
	c.clearBubbleHidden()
	c.emitState()
}

// showMainIfReady 尝试显示主窗口。首帧还没就绪时只记录聚焦意图，
// 等 MarkMainWindowReady 到达后再补一次 Show/Focus。
func (c *Controller) showMainIfReady(window *application.WebviewWindow, focus bool) {
	if window == nil {
		return
	}
	c.mu.Lock()
	ready := c.mainReady
	if !ready && focus {
		c.mainShowFocus = true
	}
	c.mu.Unlock()
	if !ready {
		return
	}
	window.Show()
	if focus {
		window.Focus()
	}
}

// revealMain 在确认窗口仍是当前主窗口且尚未就绪后显示它。前端
// 首帧回调和兜底定时器都走这里，重复调用是幂等的。
func (c *Controller) revealMain(window *application.WebviewWindow) {
	if window == nil {
		return
	}
	c.mu.Lock()
	if c.mainReady || c.windows[ModeMain] != window {
		c.mu.Unlock()
		return
	}
	c.mainReady = true
	focus := c.mainShowFocus
	c.mainShowFocus = false
	if c.mainRevealTimer != nil {
		c.mainRevealTimer.Stop()
		c.mainRevealTimer = nil
	}
	c.mu.Unlock()
	window.Show()
	if focus {
		window.Focus()
	}
}

// armMainRevealFallback 在窗口运行时就绪后启动兜底显示。正常情况
// 下前端会先调用 MarkMainWindowReady，定时器随即被取消；只有前端
// 脚本异常时才需要它把窗口从隐藏状态救回来。
func (c *Controller) armMainRevealFallback(window *application.WebviewWindow) {
	if window == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.mainReady || c.windows[ModeMain] != window {
		return
	}
	if c.mainRevealTimer != nil {
		c.mainRevealTimer.Stop()
	}
	c.mainRevealTimer = time.AfterFunc(mainRevealFallback, func() {
		c.revealMain(window)
	})
}

func (c *Controller) showBubbleInternal(focus bool) {
	if window := c.current(ModeMain); window != nil {
		c.rememberMainBounds(window)
		c.detachAndClose(ModeMain)
	}
	window := c.ensureWindow(ModeBubble)
	if window == nil {
		return
	}
	c.setVisible(ModeBubble)
	window.Show()
	if focus {
		window.Focus()
	}
	c.clearBubbleHidden()
	c.emitState()
}

// showOverlayInternal 确保胶囊存在并显示。主窗口/悬浮球可见时它
// 作为辅助录音提示，隐藏态时它就是唯一可见窗口。
func (c *Controller) showOverlayInternal() {
	if c.desktop == nil {
		return
	}
	window := c.ensureWindow(ModeOverlay)
	if window == nil {
		return
	}
	setNativeWindowBounds(window, c.overlayRect())
	window.SetAlwaysOnTop(true)
	window.Show()
	c.mu.Lock()
	if c.visible == "" {
		c.visible = ModeOverlay
	}
	c.mu.Unlock()
	c.emitState()
}

func (c *Controller) emitSettings() {
	if c.desktop != nil {
		c.desktop.Event.Emit("desktop:settings")
	}
}

func (c *Controller) emitState() {
	if c.desktop == nil {
		return
	}
	c.desktop.Event.Emit("desktop:state", c.GetState())
	if c.tray != nil {
		c.tray.syncVisibility()
	}
}

func (c *Controller) ensureWindow(role string) *application.WebviewWindow {
	if c.desktop == nil {
		return nil
	}
	if window := c.current(role); window != nil {
		return window
	}

	c.windowMu.Lock()
	defer c.windowMu.Unlock()
	if window := c.current(role); window != nil {
		return window
	}

	rect := c.rectFor(role)
	var opts application.WebviewWindowOptions
	switch role {
	case ModeMain:
		opts = c.mainWindowOptions(rect)
	case ModeBubble:
		opts = c.bubbleWindowOptions(rect)
	case ModeOverlay:
		opts = c.overlayWindowOptions(rect)
	default:
		return nil
	}
	window := c.desktop.Window.NewWithOptions(opts)
	if window == nil {
		return nil
	}

	c.mu.Lock()
	c.windows[role] = window
	if role == ModeMain {
		// 新主窗口重新等待前端首帧；旧窗口的兜底定时器不能带过来。
		c.mainReady = false
		c.mainShowFocus = false
		if c.mainRevealTimer != nil {
			c.mainRevealTimer.Stop()
			c.mainRevealTimer = nil
		}
	}
	c.mu.Unlock()

	window.OnWindowEvent(events.Common.WindowRuntimeReady, func(*application.WindowEvent) {
		c.prepareWindow(role, window, rect)
	})
	if role == ModeMain {
		window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
			c.onMainClosing(window, event)
		})
	}
	return window
}

func (c *Controller) prepareWindow(role string, window *application.WebviewWindow, rect application.Rect) {
	if window == nil {
		return
	}
	setNativeWindowBounds(window, rect)
	if role == ModeMain {
		// 前端正常情况下会主动报告首帧；这里只兜底，避免脚本异常时
		// 主窗口永远停在隐藏状态。
		c.armMainRevealFallback(window)
		return
	}
	if role != ModeBubble {
		return
	}
	// macOS 仍需要 cgo 把窗口切成真正 borderless；Windows/Linux 的
	// 透明无边框由创建选项负责。
	if runtime.GOOS == "darwin" {
		setBubbleChrome(window.NativeWindow())
	}
	// chrome 落定后再挂 hover：切 styleMask 时 WebView 会短暂换父视图，
	// 观测者不必跟着经历这段过渡。
	startBubbleHoverTracking(window.NativeWindow())
}

// detachAndClose 先摘掉窗口并立即隐藏，稍后才真正 Close。
// 绑定调用（例如悬浮球的“展开”）返回后，Wails 还要把 HTTP 响应写回
// 发起窗口；如果同步销毁，webview 已经没了，transport 会 SIGSEGV。
func (c *Controller) detachAndClose(role string) {
	c.windowMu.Lock()
	c.mu.Lock()
	window := c.windows[role]
	delete(c.windows, role)
	if role == ModeMain {
		c.closePending = false
		c.mainReady = false
		c.mainShowFocus = false
		if c.mainRevealTimer != nil {
			c.mainRevealTimer.Stop()
			c.mainRevealTimer = nil
		}
	}
	c.mu.Unlock()
	c.windowMu.Unlock()

	if window == nil {
		return
	}
	if role == ModeBubble {
		// 悬浮球窗口挂着原生 hover 观测者，它按 50ms 定时读 WKWebView。
		// 窗口一销毁，WebView 与定时器都会失效，必须在窗口还活着时
		// 解绑，否则下一次轮询就是访问已释放对象（主线程 SIGSEGV）。
		stopBubbleHoverTracking(window.NativeWindow())
	}
	window.Hide()
	time.AfterFunc(250*time.Millisecond, func() {
		// 此时窗口已从 windows 摘除，onMainClosing 会按身份判断
		// 这是控制器主动关闭并直接放行，不再依赖瞬时放行标记。
		window.Close()
	})
}

func (c *Controller) hideOverlayIfIdle() {
	c.mu.RLock()
	status := c.session.Status
	visible := c.visible
	starting := c.starting
	window := c.windows[ModeOverlay]
	c.mu.RUnlock()
	if status != "idle" || starting || window == nil {
		return
	}
	// 先隐藏，等绑定响应和最后一次状态发布都结束再真正关闭。
	// 窗口暂时留在 map 里：宽限期内再来一次热键可以直接复用。
	window.Hide()
	if visible == ModeOverlay {
		c.setVisible("")
		c.emitState()
	}
	c.mu.Lock()
	if c.overlayHideTimer != nil {
		c.overlayHideTimer.Stop()
	}
	c.overlayHideTimer = time.AfterFunc(250*time.Millisecond, c.closeOverlayIfIdle)
	c.mu.Unlock()
}

func (c *Controller) closeOverlayIfIdle() {
	c.mu.Lock()
	if c.session.Status != "idle" || c.starting {
		c.overlayHideTimer = nil
		c.mu.Unlock()
		return
	}
	window := c.windows[ModeOverlay]
	delete(c.windows, ModeOverlay)
	c.overlayHideTimer = nil
	c.mu.Unlock()
	if window != nil {
		window.Close()
	}
}

func (c *Controller) rectFor(role string) application.Rect {
	switch role {
	case ModeMain:
		return c.mainRect()
	case ModeBubble:
		return c.bubbleRect()
	case ModeOverlay:
		return c.overlayRect()
	default:
		return c.workArea()
	}
}

func (c *Controller) mainRect() application.Rect {
	c.mu.RLock()
	last := c.mainBounds
	hasLast := c.hasMainBounds
	c.mu.RUnlock()
	if hasLast {
		center := point{X: last.X + last.Width/2, Y: last.Y + last.Height/2}
		if screen := c.screenAt(center); screen != nil {
			return clampRectToWorkArea(last, screen.WorkArea)
		}
	}
	area := c.workArea()
	return clampRectToWorkArea(centeredRect(area, mainWidth, mainHeight), area)
}

func (c *Controller) bubbleRect() application.Rect {
	area := c.workArea()
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

func (c *Controller) overlayRect() application.Rect {
	return overlayTargetBounds(c.workArea())
}

func (c *Controller) workArea() application.Rect {
	for _, role := range []string{ModeMain, ModeBubble, ModeOverlay} {
		window := c.current(role)
		if window == nil {
			continue
		}
		if screen, err := window.GetScreen(); err == nil && screen != nil {
			return screen.WorkArea
		}
	}
	if c.desktop != nil {
		if screen := c.desktop.Screen.GetPrimary(); screen != nil {
			return screen.WorkArea
		}
	}
	return application.Rect{Width: 1440, Height: 900}
}

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

func (c *Controller) rememberMainBounds(window *application.WebviewWindow) {
	if window == nil {
		return
	}
	bounds := window.Bounds()
	if bounds.Width < mainMinWidth || bounds.Height < mainMinHeight {
		return
	}
	c.mu.Lock()
	c.mainBounds = bounds
	c.hasMainBounds = true
	c.mu.Unlock()
}

func (c *Controller) persistBubblePosition() error {
	if c.app == nil {
		return nil
	}
	window := c.current(ModeBubble)
	if window == nil || !window.IsVisible() {
		return nil
	}
	x, y := window.Position()
	center := point{X: x + bubbleWidth/2, Y: y + bubbleHeight/2}
	area := c.workArea()
	if screen := c.screenAt(center); screen != nil {
		area = screen.WorkArea
	}
	position := clampPoint(point{X: x, Y: y}, area)

	cfg := c.app.GetDesktopConfig()
	if cfg.BubblePosition != nil &&
		cfg.BubblePosition.X == position.X &&
		cfg.BubblePosition.Y == position.Y {
		return nil
	}
	cfg.BubblePosition = &backend.BubblePosition{X: position.X, Y: position.Y}
	return c.app.SaveDesktopConfig(cfg)
}

func (c *Controller) clearBubbleHidden() {
	if c.app == nil {
		return
	}
	if c.app.GetDesktopConfig().BubbleHidden {
		_ = c.app.SetBubbleHidden(false)
	}
}

// normalizeMode 把“没有可见面”的空串统一成 hidden，让桌面状态和
// 托盘菜单共用同一个判据。
func normalizeMode(mode string) string {
	if mode == "" {
		return ModeHidden
	}
	return mode
}

// currentMode 返回当前可见面，供托盘菜单等只关心状态的调用方使用。
// 只读 c.visible：bubbleHidden 是持久化偏好，不能代表此刻屏幕上
// 到底有没有悬浮球。
func (c *Controller) currentMode() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return normalizeMode(c.visible)
}

// setVisible 记录当前可见面，并同步 Dock/任务栏图标：只有主窗口在
// 时应用才是常规应用。所有窗口切换都必须经过这里，否则 Dock 状态会
// 和真实可见面脱节。
func (c *Controller) setVisible(role string) {
	c.mu.Lock()
	c.visible = role
	c.mu.Unlock()
	c.syncDockIcon(role)
}

func (c *Controller) current(role string) *application.WebviewWindow {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.windows[role]
}

func (c *Controller) sessionActive() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.session.Status != "" && c.session.Status != "idle"
}

func (c *Controller) mainWindow() (*application.WebviewWindow, error) {
	if err := c.ensureRuntime(); err != nil {
		return nil, err
	}
	window := c.current(ModeMain)
	if window == nil {
		return nil, errors.New("main window is not open")
	}
	return window, nil
}

func (c *Controller) ensureRuntime() error {
	c.mu.RLock()
	started := c.started
	desktop := c.desktop
	c.mu.RUnlock()
	if !started || desktop == nil {
		return errors.New("desktop controller is not started")
	}
	return nil
}

func (c *Controller) keepBubbleOnTop() bool {
	if c.app == nil {
		return true
	}
	return c.app.GetDesktopConfig().KeepBubbleOnTop
}
