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
//
// 观测者的寿命必须等于浮动球窗口：定时器每 50ms 读一次 WKWebView，
// 窗口销毁时 WebView 也随之释放，越过这个点的任何一次轮询都是给
// 已释放的 Objective-C 对象发消息（主线程 SIGSEGV）。因此 WebView
// 用强引用——宁可泄漏也不悬空，并在窗口关闭通知里统一解绑。
@interface OTBubbleHoverObserver : NSObject
@property(retain) WKWebView *webView;
// 定时器由主 RunLoop 持有，这里只留指针：retain 会和「timer 持有
// target」形成环，-dealloc 永远等不到，旧观测者会带着定时器一直轮询
// 已经销毁的窗口。
@property(assign) NSTimer *pointerTimer;
// tracking area 由 WebView 持有，解绑时只负责移除。
@property(assign) NSTrackingArea *trackingArea;
@property(assign) BOOL pointerInside;
// 跟随窗口失败的轮询次数，用来区分“过渡态”和“窗口真的没了”。
@property(assign) int missedWindowTicks;
@end

static char otBubbleHoverObserverKey;
static void otBubbleHoverDetach(WKWebView *webView);

@implementation OTBubbleHoverObserver

// 窗口已经不在时 WebView 也即将释放，这里只处理还活着的窗口。
- (void)notifyHover:(BOOL)inside {
    WKWebView *webView = self.webView;
    if (webView == nil || webView.window == nil) {
        return;
    }
    NSString *script = inside
        ? @"window.__shiyuBubbleHover&&window.__shiyuBubbleHover(true)"
        : @"window.__shiyuBubbleHover&&window.__shiyuBubbleHover(false)";
    [webView evaluateJavaScript:script completionHandler:nil];
}

- (void)mouseEntered:(NSEvent *)event {
    (void)event;
    [self notifyHover:YES];
}

- (void)mouseExited:(NSEvent *)event {
    (void)event;
    [self notifyHover:NO];
}

- (void)start {
    if (self.pointerTimer != nil) {
        return;
    }
    self.pointerInside = NO;
    self.missedWindowTicks = 0;
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
    self.missedWindowTicks = 0;
}

// stop 拆掉观测者持有的全部外部资源；调用后它只剩 WebView 关联对象
// 那一个引用，由 otBubbleHoverDetach 接着清掉。
- (void)stop {
    [self stopPointerTimer];
    if (self.trackingArea != nil) {
        [self.webView removeTrackingArea:self.trackingArea];
        self.trackingArea = nil;
    }
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

// 窗口关闭后 WebView 随即释放，观测者必须在这里退出。
- (void)windowWillClose:(NSNotification *)notification {
    (void)notification;
    otBubbleHoverDetach(self.webView);
}

// 失焦窗口收不到 mouseMoved，但 NSEvent.mouseLocation 是全局的。
// 20Hz 轮询一次指针，只有落在窗口内才发给网页，既跟手又不会在
// 主窗口或指针离开时持续占用 WebView。
- (void)pollPointer:(NSTimer *)timer {
    (void)timer;
    WKWebView *webView = self.webView;
    NSWindow *window = webView.window;
    if (webView == nil || window == nil) {
        // 建窗与切 styleMask 时 WebView 可能短暂脱离窗口，这一帧跳过
        // 即可；连续 1 秒都看不到窗口说明解绑漏了，停表自愈。
        self.missedWindowTicks++;
        if (self.missedWindowTicks >= 20) {
            [[self retain] autorelease];
            [self stopPointerTimer];
        }
        return;
    }
    self.missedWindowTicks = 0;
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
    [self stop];
    [_webView release];
    [super dealloc];
}

@end

// otBubbleHoverDetach 幂等解绑：清掉 WebView 上的关联对象，再让观测者
// 停掉定时器、tracking area 与窗口通知。Go 主动解绑和窗口关闭通知
// 都走这里，重复调用安全。
static void otBubbleHoverDetach(WKWebView *webView) {
    if (webView == nil) {
        return;
    }
    OTBubbleHoverObserver *observer =
        (OTBubbleHoverObserver *)objc_getAssociatedObject(webView, &otBubbleHoverObserverKey);
    if (observer == nil) {
        return;
    }
    // 清关联会释放观测者，先保住这一帧再通知它收尾。
    [[observer retain] autorelease];
    objc_setAssociatedObject(webView, &otBubbleHoverObserverKey, nil,
                             OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    [observer stop];
}

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
        NSTrackingAreaOptions options =
            NSTrackingMouseEnteredAndExited | NSTrackingActiveAlways | NSTrackingInVisibleRect;
        NSTrackingArea *area = [[NSTrackingArea alloc] initWithRect:NSZeroRect
                                                           options:options
                                                             owner:observer
                                                          userInfo:nil];
        observer.trackingArea = area;
        [webView addTrackingArea:area];
        [area release];
        // tracking area 不持有 owner，由 WebView 的关联对象保活；窗口
        // 关闭通知负责解绑，观测者不会越过窗口继续存活。
        objc_setAssociatedObject(webView, &otBubbleHoverObserverKey, observer,
                                 OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        [[NSNotificationCenter defaultCenter] addObserver:observer
                                                selector:@selector(windowWillClose:)
                                                    name:NSWindowWillCloseNotification
                                                  object:window];
        [observer start];
        [observer release];
    });
}

// 由 Go 在销毁窗口前调用。窗口已经释放时 ref 为 NULL，直接返回。
static void otTeardownBubbleHoverTracking(void *ref) {
    if (ref == NULL) {
        return;
    }
    otHoverRunOnMain(^{
        NSWindow *window = (NSWindow *)ref;
        otBubbleHoverDetach([window webView]);
    });
}
*/
import "C"

import "unsafe"

// startBubbleHoverTracking 让浮动球在应用失焦时也能报告悬停。
// 必须在原生窗口就绪后调用；重复调用是安全的。
func startBubbleHoverTracking(native unsafe.Pointer) {
	C.otInstallBubbleHoverTracking(native)
}

// stopBubbleHoverTracking 在窗口销毁前解绑观测者。定时器每 50ms 读
// 一次 WKWebView，窗口关掉后这两者都会失效，晚一次轮询就是野指针。
// 必须在窗口还活着时调用；窗口已销毁（native 为 nil）时是空操作。
func stopBubbleHoverTracking(native unsafe.Pointer) {
	C.otTeardownBubbleHoverTracking(native)
}
