package desktop

import "testing"

// 悬浮球窗口可能已经销毁（NativeWindow 返回 nil），构建也可能落在
// 没有 cgo 的平台；两个入口都要能接受 nil 并支持重复调用，否则托盘
// 隐藏、退出这些路径会直接走到空指针。
func TestBubbleHoverTrackingToleratesMissingWindow(t *testing.T) {
	startBubbleHoverTracking(nil)
	stopBubbleHoverTracking(nil)
	stopBubbleHoverTracking(nil)
}
