//go:build darwin

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func traySupported() bool { return true }

// trayLeftClickOpensMenu：macOS 菜单栏图标左键即开菜单，与系统
// 自带菜单栏应用一致；右键同样开菜单。
func trayLeftClickOpensMenu() bool { return true }

// trayApplyIcon 用系统模板图加载静态图标：菜单栏深浅、失焦与高亮
// 都由系统按模板自动适配，与邻近图标完全一致。录音不再换图——
// macOS 本身有麦克风使用中指示，其他菜单栏应用也不改图标颜色。
// 模板标志虽是粘性的，但图标只设一次、不再切换，没有副作用。
func trayApplyIcon(icon *application.SystemTray) {
	if icon == nil {
		return
	}
	icon.SetTemplateIcon(trayTemplateIcon)
}
