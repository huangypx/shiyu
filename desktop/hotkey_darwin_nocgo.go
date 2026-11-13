//go:build darwin && !cgo

package desktop

// 没有 cgo 就无法链接 Carbon，全局热键退回窗口内快捷键兜底。
// macOS 发布构建必须使用 cgo（见 chrome_darwin_nocgo.go）。
func registerPlatformHotkey(hotkeySpec, func()) (*hotkeyRegistration, error) {
	return &hotkeyRegistration{
		available: false,
		reason:    "global hotkey requires a cgo build on macOS",
	}, nil
}
