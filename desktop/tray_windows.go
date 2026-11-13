//go:build windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func traySupported() bool { return true }

// trayLeftClickOpensMenu：Windows 右下角图标左键切换悬浮球显隐，
// 右键才开菜单，与多数 Windows 托盘应用的习惯一致。
func trayLeftClickOpensMenu() bool { return false }

// trayApplyIcon：Windows 任务栏用静态中灰图。录音不改图标也不改
// tooltip——系统本身会提示麦克风使用中，与 macOS 的设计一致。
// PNG 直接交给 CreateSmallHIconFromImage，无需另做 .ico。
func trayApplyIcon(icon *application.SystemTray) {
	if icon == nil {
		return
	}
	icon.SetIcon(trayIdleIcon)
}
