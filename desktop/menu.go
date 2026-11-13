package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// bubbleMenuID 同时用于 app.ContextMenu 注册和前端球的
// --custom-contextmenu CSS 属性，两处必须保持一致。
const bubbleMenuID = "bubble-menu"

// RegisterSystemTray 让隐藏浮动球的用户也能找回主窗口或退出后台进程。
func RegisterSystemTray(app *application.App, controller *Controller, icon []byte) {
	menu := app.Menu.New()
	menu.Add("打开拾语").OnClick(func(*application.Context) { _ = controller.ShowMainWindow() })
	menu.Add("退出拾语").OnClick(func(*application.Context) { controller.Quit() })
	tray := app.SystemTray.New()
	tray.SetIcon(icon).SetMenu(menu).OnClick(func() { go func() { _ = controller.ShowMainWindow() }() })
	tray.SetTooltip("拾语")
}

// RegisterBubbleMenu 把浮动球的右键菜单注册为 Wails v3 的
// 原生 context menu。菜单由系统绘制，在鼠标指针处弹出并自动
// 处理屏幕边缘翻转，因此不再需要放大窗口或计算菜单几何。
func RegisterBubbleMenu(app *application.App, controller *Controller) {
	if app == nil || controller == nil {
		return
	}

	menu := app.ContextMenu.New()
	menu.Add("展开主窗口").OnClick(func(*application.Context) {
		_ = controller.ShowMainWindow()
	})
	// 「取消这段转写」只在界面处于录音或处理中时可用；状态由 React
	// 侧通过 Controller.SetTranscribing 同步过来，因为 Go 并不知道
	// 录音进行到哪一步。
	cancel := menu.Add("取消这段转写")
	cancel.SetEnabled(false)
	cancel.OnClick(func(*application.Context) {
		controller.requestCancelTranscription()
	})
	controller.attachCancelMenuItem(cancel)
	menu.Add("打开偏好设置").OnClick(func(*application.Context) {
		_ = controller.OpenSettings()
	})
	menu.AddSeparator()
	menu.Add("隐藏悬浮球").OnClick(func(*application.Context) {
		_ = controller.HideWindow()
	})
	menu.Add("退出拾语").OnClick(func(*application.Context) {
		controller.Quit()
	})
	app.ContextMenu.Add(bubbleMenuID, menu)
}
