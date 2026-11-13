package desktop

import (
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
)

func mainWindowInForeground(window *application.WebviewWindow) bool {
	foreground := w32.GetForegroundWindow()
	if foreground != 0 {
		_, pid := w32.GetWindowThreadProcessId(foreground)
		return pid == os.Getpid()
	}
	return window.IsFocused()
}

func presentBubbleWindow(window *application.WebviewWindow, onTop bool) {
	native := window.NativeWindow()
	if native == nil {
		window.SetAlwaysOnTop(onTop)
		return
	}
	hwnd := w32.HWND(uintptr(native))
	application.InvokeSync(func() {
		// Wails 恢复 WebView 时还会调用 SW_SHOW。暂时禁止激活，防止原输入框失焦。
		if w32.IsWindowEnabled(hwnd) {
			w32.EnableWindow(hwnd, false)
			defer w32.EnableWindow(hwnd, true)
		}
		style := uint32(w32.GetWindowLong(hwnd, w32.GWL_STYLE))
		if style&w32.WS_VISIBLE == 0 || style&(w32.WS_MINIMIZE|w32.WS_MAXIMIZE) != 0 {
			w32.ShowWindow(hwnd, w32.SW_SHOWNOACTIVATE)
		}
		order := uintptr(w32.HWND_NOTOPMOST)
		if onTop {
			order = w32.HWND_TOPMOST
		}
		w32.SetWindowPos(hwnd, order, 0, 0, 0, 0, w32.SWP_NOMOVE|w32.SWP_NOSIZE|w32.SWP_NOACTIVATE)
		window.Show()
	})
}

func hideBubbleWindow(window *application.WebviewWindow) {
	window.Hide()
}
