//go:build !darwin || !cgo

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// setNativeWindowBounds 在无 cgo 或其他平台上退回 Wails 的
// SetBounds。Windows/Linux 的实现直接移动/调整原生窗口，不会像
// macOS 那样给每次尺寸变化套一段 AppKit 动画。
func setNativeWindowBounds(window *application.WebviewWindow, bounds application.Rect) {
	if window != nil {
		window.SetBounds(bounds)
	}
}
