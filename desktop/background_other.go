//go:build !windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// mainWindowInForeground 非 Windows 用窗口焦点近似判断主窗口是否在前台，
// 供失焦自动收起复核使用。
func mainWindowInForeground(window *application.WebviewWindow) bool {
	return window.IsFocused()
}
