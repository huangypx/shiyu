package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// tray 把系统托盘装配成平台无关的一组动作：显示/隐藏悬浮球、
// 打开主窗口、退出。托盘图标是静态的——macOS 用系统模板图、Windows
// 用中灰图，录音不换图：macOS 本身有麦克风使用中指示，其他菜单栏
// 应用也不改图标颜色。平台差异（左键行为、图标加载方式）收敛到
// tray_darwin.go / tray_windows.go。
//
// 托盘只在 ServiceStartup 里经 app.SystemTray.New() 创建，绝不手动
// Run()：Wails 的 pendingRun 会在 app.Run 之后补跑，提前 Run 在
// running=false 时静默失效，macOS 二次 Run 直接 Fatal。
type tray struct {
	controller *Controller
	icon       *application.SystemTray
	showItem   *application.MenuItem
	hideItem   *application.MenuItem
	// bubbleSeparator 是悬浮球两项与“打开主窗口”之间的分隔线。
	// 两项都隐藏时它也要隐藏，否则菜单顶部会留下一条空分隔。
	bubbleSeparator *application.MenuItem
}

// newTray 装配托盘。不支持托盘的平台（Linux）返回 nil，所有方法
// 都对 nil 接收者安全，调用方无需到处判空。
func newTray(c *Controller) *tray {
	if c == nil || c.desktop == nil || !traySupported() {
		return nil
	}
	t := &tray{controller: c}

	menu := c.desktop.Menu.New()
	t.showItem = menu.Add("显示悬浮球").OnClick(func(*application.Context) {
		// 主窗口可见时没有悬浮球可显示，点了也不该把主窗口换走。
		if c.currentMode() == ModeMain {
			return
		}
		_ = c.SetBubbleHidden(false)
	})
	t.hideItem = menu.Add("隐藏悬浮球").OnClick(func(*application.Context) {
		// 只有悬浮球真的在屏幕上时“隐藏”才成立；主窗口可见时点中
		// 这一项会把主窗口一起收走。
		if c.currentMode() != ModeBubble {
			return
		}
		_ = c.SetBubbleHidden(true)
	})
	menu.AddSeparator()
	t.bubbleSeparator = menu.ItemAt(2)
	menu.Add("打开主窗口").OnClick(func(*application.Context) {
		_ = c.ShowMainWindow()
	})
	menu.AddSeparator()
	menu.Add("退出拾语").OnClick(func(*application.Context) {
		c.Quit()
	})

	t.icon = c.desktop.SystemTray.New()
	t.icon.SetMenu(menu)
	trayApplyIcon(t.icon)
	t.icon.SetTooltip("拾语")
	if trayLeftClickOpensMenu() {
		t.icon.OnClick(func() { t.icon.OpenMenu() })
	} else {
		t.icon.OnClick(t.toggleBubble)
	}
	t.icon.OnRightClick(func() { t.icon.OpenMenu() })
	t.syncVisibility()
	return t
}

// syncVisibility 按当前可见面组织两个悬浮球菜单项：主窗口可见时
// 两项都不出现；悬浮球可见时只留“隐藏”；只剩托盘/胶囊时只留
// “显示”。菜单项的显隐与启用状态由 emitState 在每次模式变化后刷新。
func (t *tray) syncVisibility() {
	if t == nil || t.controller == nil {
		return
	}
	state := trayBubbleMenuStateFor(t.controller.currentMode())
	// 绑定方法跑在 HTTP/goroutine 上，而 NSMenuItem 只能在主线程
	// 修改；直接在调用线程 SetHidden/SetEnabled 会在 AppKit 里 SIGSEGV。
	application.InvokeSync(func() {
		t.showItem.SetHidden(state.showHidden).SetEnabled(!state.showHidden)
		t.hideItem.SetHidden(state.hideHidden).SetEnabled(!state.hideHidden)
		if t.bubbleSeparator != nil {
			t.bubbleSeparator.SetHidden(state.showHidden && state.hideHidden)
		}
	})
}

// trayBubbleMenuState 描述两个悬浮球菜单项此刻该不该出现。假值
// 表示可见且可点；两项都隐藏时菜单里只剩打开主窗口和退出。
type trayBubbleMenuState struct {
	showHidden bool
	hideHidden bool
}

// trayBubbleMenuStateFor 用当前可见面而不是 bubbleHidden 判断菜单：
// 主窗口可见时悬浮球并不存在，两项都点不得；只剩托盘/胶囊时才需要
// “显示悬浮球”，悬浮球可见时才需要“隐藏悬浮球”。
func trayBubbleMenuStateFor(mode string) trayBubbleMenuState {
	switch normalizeMode(mode) {
	case ModeMain:
		return trayBubbleMenuState{showHidden: true, hideHidden: true}
	case ModeBubble:
		return trayBubbleMenuState{showHidden: true}
	default:
		return trayBubbleMenuState{hideHidden: true}
	}
}

// toggleBubble 是 Windows 左键的默认动作。主窗口可见时没有悬浮球，
// 左键只把主窗口叫到前台，不能把界面整个收走；其余情况在显示和
// 隐藏悬浮球之间切换。macOS 左键开菜单，不走这里。
func (t *tray) toggleBubble() {
	if t == nil || t.controller == nil {
		return
	}
	switch t.controller.currentMode() {
	case ModeBubble:
		_ = t.controller.SetBubbleHidden(true)
	case ModeMain:
		_ = t.controller.ShowMainWindow()
	default:
		_ = t.controller.SetBubbleHidden(false)
	}
}

// destroy 只在 ServiceShutdown 调一次，移除菜单栏/任务栏图标。
func (t *tray) destroy() {
	if t == nil || t.icon == nil {
		return
	}
	t.icon.Destroy()
	t.icon = nil
}
