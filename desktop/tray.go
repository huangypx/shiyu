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
		_ = c.SetBubbleHidden(false)
	})
	t.hideItem = menu.Add("隐藏悬浮球（仅保留托盘）").OnClick(func(*application.Context) {
		_ = c.SetBubbleHidden(true)
	})
	menu.AddSeparator()
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

// syncVisibility 让「显示/隐藏悬浮球」两项互斥可用：隐藏态只能显示，
// 可见态只能隐藏。菜单项的启用状态由 emitState 在每次模式/隐藏态
// 变化后刷新。
func (t *tray) syncVisibility() {
	if t == nil || t.controller == nil || t.controller.app == nil {
		return
	}
	hidden := t.controller.app.GetDesktopConfig().BubbleHidden
	t.showItem.SetEnabled(hidden)
	t.hideItem.SetEnabled(!hidden)
}

// toggleBubble 是 Windows 左键的默认动作：在隐藏与显示之间切换。
// macOS 左键开菜单，不走这里。
func (t *tray) toggleBubble() {
	if t == nil || t.controller == nil || t.controller.app == nil {
		return
	}
	hidden := t.controller.app.GetDesktopConfig().BubbleHidden
	_ = t.controller.SetBubbleHidden(!hidden)
}

// destroy 只在 ServiceShutdown 调一次，移除菜单栏/任务栏图标。
func (t *tray) destroy() {
	if t == nil || t.icon == nil {
		return
	}
	t.icon.Destroy()
	t.icon = nil
}
