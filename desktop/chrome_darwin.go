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

// 进入浮动模式前的 styleMask。主窗口是 TitleBarHidden + 全尺寸内容，
// 恢复时必须原样还原，交通灯和标题栏位置才不会跳。
static NSUInteger otMainStyleMask = 0;

static void otSetBubbleChrome(void *ref) {
    if (ref == NULL) {
        return;
    }
    otChromeRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        if (otMainStyleMask == 0) {
            otMainStyleMask = [window styleMask];
        }
        // 真正的 borderless 窗口：没有标题栏、没有交通灯，也不会
        // 在透明球窗外围画出一个方形阴影。
        [window setStyleMask:NSWindowStyleMaskBorderless];
        [window setHasShadow:NO];
        [window setOpaque:NO];
        [window setBackgroundColor:[NSColor clearColor]];
    });
}

static void otRestoreMainChrome(void *ref) {
    if (ref == NULL) {
        return;
    }
    otChromeRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        // 正常启动时先走主窗口路径；在这里记下原始 mask，
        // 之后第一次进入浮动模式就不必依赖调用顺序。
        if (otMainStyleMask == 0) {
            otMainStyleMask = [window styleMask];
        }
        [window setStyleMask:otMainStyleMask];
        [window setHasShadow:YES];
        [window setOpaque:NO];
        [window setBackgroundColor:[NSColor clearColor]];
        [window setTitlebarAppearsTransparent:YES];
        [window setTitleVisibility:NSWindowTitleHidden];
    });
}
*/
import "C"

import "unsafe"

// setBubbleChrome 把已经存在的 NSWindow 切成 borderless 并关掉阴影。
// 必须在进入 92x92 浮动模式时调用；native 为 nil 时说明平台窗口
// 还没创建，等 WindowRuntimeReady 再补一次。
func setBubbleChrome(native unsafe.Pointer) {
	C.otSetBubbleChrome(native)
}

// restoreMainChrome 恢复进入浮动模式前保存的 styleMask，并重新
// 打开窗口阴影和透明标题栏。
func restoreMainChrome(native unsafe.Pointer) {
	C.otRestoreMainChrome(native)
}

// platformBackdropKind 只作为前端 CSS 的样式提示。原生材质视图在
// v3 迁移后不再安装：主窗口的画布本身不透明，材质本来也透不出来。
func platformBackdropKind() string { return "vibrancy" }
