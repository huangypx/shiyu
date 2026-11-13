//go:build !darwin && !windows

package desktop

// Linux 走 hotkey.go 里的 xbindkeys 路径；其余平台没有全局
// 热键适配器，前端继续用窗口内快捷键兜底。
func registerPlatformHotkey(hotkeySpec, func()) (*hotkeyRegistration, error) {
	return &hotkeyRegistration{
		available: false,
		reason:    "global hotkey adapter is not enabled on this platform yet",
	}, nil
}
