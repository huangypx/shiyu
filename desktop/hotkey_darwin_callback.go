//go:build darwin && cgo

package desktop

/*
#include <stdlib.h>
*/
import "C"

// shiyuHotKeyDispatch 由 Carbon 事件处理器在主线程调用。这里只
// 把触发转交给业务回调，绝不阻塞事件派发：回调里的窗口显示与
// chrome 切换可能再跳回主线程，同步执行会死锁。
//
//export shiyuHotKeyDispatch
func shiyuHotKeyDispatch() {
	darwinHotkeyMu.RLock()
	callback := darwinHotkeyCallback
	darwinHotkeyMu.RUnlock()
	if callback != nil {
		go callback()
	}
}
