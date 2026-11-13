//go:build windows

package desktop

import (
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

// mainWindowInForeground 用前台窗口的进程 ID 判断，避免子控件交接
// 键盘焦点造成误判；取不到前台窗口时退回窗口焦点。
func mainWindowInForeground(window *application.WebviewWindow) bool {
	foreground := w32.GetForegroundWindow()
	if foreground != 0 {
		_, pid := w32.GetWindowThreadProcessId(foreground)
		return pid == os.Getpid()
	}
	return window.IsFocused()
}
