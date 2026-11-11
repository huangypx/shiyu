//go:build windows

package desktop

import (
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	windowsBackdropOnce sync.Once
	windowsBackdropKind string
)

// Windows 的主窗口和浮动球都使用 frameless 窗口，形态由
// Controller 的 SetFrameless/尺寸调用处理；这里没有额外的原生 chrome。
func setBubbleChrome(unsafe.Pointer) {}

func restoreMainChrome(unsafe.Pointer) {}

// platformBackdropKind 报告透明 webview 背后是否有 Mica 背景。
// Windows 11 22H2（build 22621）是首个支持
// DWMWA_SYSTEMBACKDROP_TYPE 的版本。
func platformBackdropKind() string {
	windowsBackdropOnce.Do(func() {
		version := windows.RtlGetVersion()
		if version.MajorVersion >= 10 && version.BuildNumber >= 22621 {
			windowsBackdropKind = "mica"
			return
		}
		windowsBackdropKind = "none"
	})
	return windowsBackdropKind
}
