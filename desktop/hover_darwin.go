//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c -fblocks
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>
#import <dispatch/dispatch.h>

// Wails 把 WKWebView 挂在实现了 webView 属性的 NSWindow 上；这里
// 只声明读取用的分类，避免把 Wails 的 C 头文件引进本包。
@interface NSWindow (OTShiyuWebview)
- (WKWebView *)webView;
@end

static void otHoverRunOnMain(dispatch_block_t block) {
    if ([NSThread isMainThread]) {
        block();
        return;
    }
    dispatch_sync(dispatch_get_main_queue(), block);
}

// WebKit 自己的 tracking area 只在 key window 里生效，而浮动球
// 绝大多数时间都不在前台；额外挂一个 ActiveAlways 的 tracking area，
// 把进入/离开转成页面里的函数调用。函数名与 BubbleWindow.tsx 的
// window.__shiyuBubbleHover / __shiyuBubblePointer 约定一致，改一处
// 必须同步另一处。
@interface OTBubbleHoverObserver : NSObject
@property(assign) WKWebView *webView;
// 只有浮动模式才开启：主窗口面积大，逐次把鼠标位置送进网页没有意义。
@property(assign) BOOL enabled;
@property(retain) NSTimer *pointerTimer;
@property(assign) BOOL pointerInside;
@end

@implementation OTBubbleHoverObserver

- (void)mouseEntered:(NSEvent *)event {
    (void)event;
    if (!self.enabled) {
        return;
    }
    [self.webView evaluateJavaScript:@"window.__shiyuBubbleHover&&window.__shiyuBubbleHover(true)"
                  completionHandler:nil];
}

- (void)mouseExited:(NSEvent *)event {
    (void)event;
    if (!self.enabled) {
        return;
    }
    [self.webView evaluateJavaScript:@"window.__shiyuBubbleHover&&window.__shiyuBubbleHover(false)"
                  completionHandler:nil];
}

- (void)startPointerTimer {
    if (self.pointerTimer != nil) {
        return;
    }
    self.pointerInside = NO;
    self.pointerTimer = [NSTimer scheduledTimerWithTimeInterval:0.05
                                                         target:self
                                                       selector:@selector(pollPointer:)
                                                       userInfo:nil
                                                        repeats:YES];
}

- (void)stopPointerTimer {
    [self.pointerTimer invalidate];
    self.pointerTimer = nil;
    self.pointerInside = NO;
}

// 失焦窗口收不到 mouseMoved，但 NSEvent.mouseLocation 是全局的。
// 20Hz 轮询一次指针，只有落在窗口内才发给网页，既跟手又不会在
// 主窗口或指针离开时持续占用 WebView。
- (void)pollPointer:(NSTimer *)timer {
    (void)timer;
    WKWebView *webView = self.webView;
    NSWindow *window = webView.window;
    if (webView == nil || window == nil) {
        return;
    }
    NSPoint screenPoint = [NSEvent mouseLocation];
    NSRect frame = [window frame];
    NSPoint windowPoint = NSMakePoint(screenPoint.x - frame.origin.x,
                                      screenPoint.y - frame.origin.y);
    NSPoint point = [webView convertPoint:windowPoint fromView:nil];
    if (!NSPointInRect(point, webView.bounds)) {
        if (self.pointerInside) {
            self.pointerInside = NO;
            [webView evaluateJavaScript:
                @"window.__shiyuBubblePointer&&window.__shiyuBubblePointer(-1,-1)"
                         completionHandler:nil];
        }
        return;
    }
    self.pointerInside = YES;
    // WKWebView 的坐标系与 CSS 的左上角原点不一定一致，按 isFlipped
    // 折一次，页面收到的就是 elementFromPoint 能直接使用的坐标。
    CGFloat cssY = [webView isFlipped] ? point.y : webView.bounds.size.height - point.y;
    NSString *script = [NSString stringWithFormat:
        @"window.__shiyuBubblePointer&&window.__shiyuBubblePointer(%g,%g)",
        point.x, cssY];
    [webView evaluateJavaScript:script completionHandler:nil];
}

- (void)dealloc {
    [self stopPointerTimer];
    [super dealloc];
}

@end

static char otBubbleHoverObserverKey;

static void otInstallBubbleHoverTracking(void *ref) {
    if (ref == NULL) {
        return;
    }
    otHoverRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        WKWebView *webView = [window webView];
        if (webView == nil) {
            return;
        }
        // 运行时可能多次走到这里（启动就绪、热键重新显示窗口），
        // 已装过就直接返回，避免重复的 tracking area。
        if (objc_getAssociatedObject(webView, &otBubbleHoverObserverKey) != nil) {
            return;
        }
        OTBubbleHoverObserver *observer = [[OTBubbleHoverObserver alloc] init];
        observer.webView = webView;
        observer.enabled = NO;
        NSTrackingAreaOptions options =
            NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect;
        NSTrackingArea *area = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                                                           options:options
                                                             owner:observer
                                                          userInfo:nil];
        [webView addTrackingArea:area];
        // tracking area 不持有 owner，由 webview 的关联对象保活。
        objc_setAssociatedObject(webView, &otBubbleHoverObserverKey, observer,
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        [area release];
        [observer release];
    });
}

// otSetBubbleHoverEnabled 由 Go 在模式落定时调用：进入浮动模式才
// 轮询指针，主窗口下把跟踪关掉。
static void otSetBubbleHoverEnabled(void *ref, int enabled) {
    if (ref == NULL) {
        return;
    }
    otHoverRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        WKWebView *webView = [window webView];
        if (webView == nil) {
            return;
        }
        OTBubbleHoverObserver *observer =
            (OTBubbleHoverObserver *)objc_getAssociatedObject(webView, &otBubbleHoverObserverKey);
        if (observer == nil) {
            return;
        }
        observer.enabled = enabled != 0;
        if (observer.enabled) {
            [observer startPointerTimer];
        } else {
            [observer stopPointerTimer];
        }
    });
}
*/
import "C"

import "unsafe"

// enableBubbleHoverTracking 让浮动球在应用失焦时也能报告悬停。
// 必须在原生窗口就绪后调用；重复调用是安全的。
func enableBubbleHoverTracking(native unsafe.Pointer) {
	C.otInstallBubbleHoverTracking(native)
}

// setBubbleHoverTrackingEnabled 只在浮动模式打开指针跟踪。主窗口
// 下鼠标移动不需要送进网页，关掉可以减少 WebView 往返。
func setBubbleHoverTrackingEnabled(native unsafe.Pointer, enabled bool) {
	value := C.int(0)
	if enabled {
		value = 1
	}
	C.otSetBubbleHoverEnabled(native, value)
}
