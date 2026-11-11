//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -x objective-c
#cgo LDFLAGS: -framework Cocoa -framework WebKit
#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static BOOL ot_acceptsFirstMouse(id self, SEL _cmd, NSEvent *event) {
    return YES;
}

static void ot_install_first_mouse(void) {
    Class webview = NSClassFromString(@"WKWebView");
    if (webview == Nil) {
        return;
    }
    SEL selector = @selector(acceptsFirstMouse:);
    Method inherited = class_getInstanceMethod(webview, selector);
    if (inherited != NULL &&
        method_getImplementation(inherited) == (IMP)ot_acceptsFirstMouse) {
        return;
    }
    // 只在 WKWebView 上加这个覆盖，其他 AppKit 视图继续保留
    // “第一次点击激活窗口”的标准行为。
    class_addMethod(webview, selector, (IMP)ot_acceptsFirstMouse, "c@:@");
}
*/
import "C"

// enableFirstMouseClick 让浮动圆圈在其他应用处于前台时也能响应
// 第一次点击。macOS 默认把这第一次点击只用于
// 激活应用，按键根本到不了 webview，浮动圆圈看起来
// 毫无反应（也拖不动），直到应用先获得一次焦点。
func enableFirstMouseClick() {
	C.ot_install_first_mouse()
}
