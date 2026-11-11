//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa
#import <Cocoa/Cocoa.h>
#import <dispatch/dispatch.h>

// AppKit 必须在主线程访问。动画协程每帧调用一次，这里同步
// 跳回主线程，保证 frame 修改和绘制发生在同一轮 run loop。
static void otFrameRunOnMain(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_sync(dispatch_get_main_queue(), block);
}

// 直接设置 NSWindow frame，不启动 AppKit 动画。不能走
// WebviewWindow.SetBounds：Wails v3 在 macOS 上把每次尺寸变化
// 都包成 setFrame:display:animate:YES，60fps 的插值会互相打断。
static void otSetWindowFrame(void *ref, int x, int y, int width, int height) {
    otFrameRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        if (window == nil) {
            return;
        }
        NSScreen *primary = [[NSScreen screens] firstObject];
        if (primary == nil) {
            primary = [NSScreen mainScreen];
        }
        CGFloat primaryHeight = primary.frame.size.height;
        NSRect frame = NSMakeRect(x, primaryHeight - height - y, width, height);
        [window setFrame:frame display:YES animate:NO];
    });
}
*/
import "C"

import "github.com/wailsapp/wails/v3/pkg/application"

// setNativeWindowBounds 原子地改窗口 frame；原生窗口还没创建时
// 退回 Wails 的 SetBounds，保证启动阶段仍能定位。
func setNativeWindowBounds(window *application.WebviewWindow, bounds application.Rect) {
	if window == nil {
		return
	}
	native := window.NativeWindow()
	if native == nil {
		window.SetBounds(bounds)
		return
	}
	C.otSetWindowFrame(native, C.int(bounds.X), C.int(bounds.Y), C.int(bounds.Width), C.int(bounds.Height))
}
