package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// bubbleMenuID 同时用于 app.ContextMenu 注册和前端球的
// --custom-contextmenu CSS 属性，两处必须保持一致。
const bubbleMenuID = "bubble-menu"

// RegisterBubbleMenu 把浮动球的右键菜单注册为 Wails v3 的原生
// context menu。展开、取消和设置已经搬到悬停工具栏，原生菜单只
// 保留隐藏和退出这两项次要操作，避免同一个动作出现两条入口。
func RegisterBubbleMenu(app *application.App, controller *Controller) {
	if app == nil || controller == nil {
		return
	}

	menu := app.ContextMenu.New()
	menu.Add("隐藏悬浮球").OnClick(func(*application.Context) {
		_ = controller.HideWindow()
	})
	menu.AddSeparator()
	menu.Add("退出拾语").OnClick(func(*application.Context) {
		controller.Quit()
	})
	app.ContextMenu.Add(bubbleMenuID, menu)
}
