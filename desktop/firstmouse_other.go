//go:build !darwin || !cgo

package desktop

// 非 macOS/cgo 平台上 enableFirstMouseClick 是空实现：其他
// 窗口后端无论应用是否激活都会把第一次点击交给窗口。
func enableFirstMouseClick() {}
