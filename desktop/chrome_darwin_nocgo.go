//go:build darwin && !cgo

package desktop

import "unsafe"

// 没有 cgo 时无法修改 NSWindow 的 styleMask/阴影，也无法启用
// 透明 webview。应用仍可编译运行，但浮动球会带不透明底色，
// 因此 macOS 发布构建必须使用 cgo 和 private_mac_apis。
func setBubbleChrome(unsafe.Pointer) {}

func restoreMainChrome(unsafe.Pointer) {}

func platformBackdropKind() string { return "none" }
