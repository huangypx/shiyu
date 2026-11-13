//go:build !darwin || !cgo

package desktop

// setDockIconVisible 在非 macOS 平台是空实现：Windows 的任务栏按钮
// 随主窗口销毁自动消失，Linux 没有 Dock 概念，都不需要额外调用。
// macOS 无 cgo 时也编译到这里，代价只是失去运行期切换能力。
func setDockIconVisible(bool) {}
