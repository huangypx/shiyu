//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>

// Accessory 让应用从 Dock、⌘Tab 和菜单栏里消失，Regular 把它们还
// 回来。同一个值重复设置是幂等的，调用方不必自己记当前状态。
static void otSetDockVisible(int visible) {
    [NSApp setActivationPolicy:visible ? NSApplicationActivationPolicyRegular
                                       : NSApplicationActivationPolicyAccessory];
}

static int otOnMainThread(void) {
    return [NSThread isMainThread] ? 1 : 0;
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// setDockIconVisible 切换 macOS 的 Dock 图标。
// ServiceStartup 由 Wails 在主线程内联执行，可以直连 AppKit；菜单回调
// 和绑定方法跑在 goroutine 上，只能经 Wails 的主线程队列，否则 AppKit
// 会在非主线程访问上崩溃。
func setDockIconVisible(visible bool) {
	flag := C.int(0)
	if visible {
		flag = 1
	}
	apply := func() { C.otSetDockVisible(flag) }
	if C.otOnMainThread() == 1 {
		apply()
		return
	}
	application.InvokeSync(apply)
}
