//go:build !windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

func mainWindowInForeground(window *application.WebviewWindow) bool { return window.IsFocused() }

func presentBubbleWindow(window *application.WebviewWindow, onTop bool) {
	if window.IsMinimised() {
		window.UnMinimise()
	}
	if window.IsMaximised() {
		window.UnMaximise()
	}
	window.SetAlwaysOnTop(onTop)
	if window.NativeWindow() != nil && !window.IsVisible() {
		window.Show()
	}
}

func hideBubbleWindow(window *application.WebviewWindow) { window.Hide() }
