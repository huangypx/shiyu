//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

// AppKit 必须在主线程上访问。Wails 会在 goroutine 里调用绑定方法，
// 因此每个入口都先跳回主线程再碰窗口。
static void otChromeRunOnMain(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_sync(dispatch_get_main_queue(), block);
}

// 悬浮球现在是独立窗口，不再需要在主窗口和球窗之间来回切
// styleMask；这里只把球窗本身变成真正 borderless。
static void otSetBubbleChrome(void *ref) {
    if (ref == NULL) {
        return;
    }
    otChromeRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        [window setStyleMask:NSWindowStyleMaskBorderless];
        [window setHasShadow:NO];
        [window setOpaque:NO];
        [window setBackgroundColor:[NSColor clearColor]];
    });
}

static void otRestoreMainChrome(void *ref) {
    (void)ref;
}
*/
import "C"

import "unsafe"

// setBubbleChrome 把独立悬浮球窗口切成 borderless 并关掉阴影。
// 必须在浮动球窗口的 WindowRuntimeReady 里调用；native 为 nil 时
// 说明平台窗口还没创建。
func setBubbleChrome(native unsafe.Pointer) {
	C.otSetBubbleChrome(native)
}

// restoreMainChrome 已不再需要：主窗口从创建到销毁都是 titled
// window，不会被切成球窗。保留空实现只是为了平台文件签名一致。
func restoreMainChrome(native unsafe.Pointer) {
	C.otRestoreMainChrome(native)
}

// platformBackdropKind 只作为前端 CSS 的样式提示。原生材质视图在
// v3 迁移后不再安装：主窗口的画布本身不透明，材质本来也透不出来。
func platformBackdropKind() string { return "vibrancy" }
