//go:build windows

package desktop

import (
	"sync"
	"sync/atomic"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	user32 = windows.NewLazySystemDLL("user32.dll")
	dwmapi = windows.NewLazySystemDLL("dwmapi.dll")

	procGetWindowLongPtrW = user32.NewProc("GetWindowLongPtrW")
	procGetWindowLongW    = user32.NewProc("GetWindowLongW")
	procSetWindowLongPtrW = user32.NewProc("SetWindowLongPtrW")
	procSetWindowLongW    = user32.NewProc("SetWindowLongW")
	procCallWindowProcW   = user32.NewProc("CallWindowProcW")
	procExtendFrame       = dwmapi.NewProc("DwmExtendFrameIntoClientArea")

	windowsBackdropOnce sync.Once
	windowsBackdropKind string

	// bubbleFrame 表示当前停留在浮动模式。Wails 每次收到 WM_ACTIVATE
	// 都会重扩玻璃边框，窗口过程要靠这个标记决定事后要不要压回 0。
	bubbleFrame atomic.Bool

	// frameHook 保存套在 Wails 窗口过程外面的那一层。只在第一次
	// 进入浮动模式时安装，之后复用同一个回调。
	frameHookMu   sync.Mutex
	frameHookProc uintptr
	frameHookPrev uintptr
)

const (
	wmActivate   = 0x0006
	wmDpiChanged = 0x02E0
)

// gwlWndProc 是 Get/SetWindowLong 的索引 -4。负数常量不能直接转
// uintptr，用位运算取反得到 64 位下也正确的 0xFFFF...FC。
const gwlWndProc = ^uintptr(3)

// dwmMargins 与 win32 的 MARGINS 同布局。
type dwmMargins struct {
	left, right, top, bottom int32
}

// extendGlassFrame 把 DWM 的玻璃边框扩进客户区（margin 1 是 Wails 给
// frameless 窗口的默认值），或完全收回（margin 0）。
func extendGlassFrame(hwnd uintptr, margin int32) {
	margins := dwmMargins{left: margin, right: margin, top: margin, bottom: margin}
	_, _, _ = procExtendFrame.Call(hwnd, uintptr(unsafe.Pointer(&margins)))
}

func windowProcOf(hwnd uintptr) uintptr {
	if unsafe.Sizeof(uintptr(0)) == 8 {
		value, _, _ := procGetWindowLongPtrW.Call(hwnd, gwlWndProc)
		return value
	}
	value, _, _ := procGetWindowLongW.Call(hwnd, gwlWndProc)
	return value
}

func setWindowProcOf(hwnd, proc uintptr) uintptr {
	if unsafe.Sizeof(uintptr(0)) == 8 {
		value, _, _ := procSetWindowLongPtrW.Call(hwnd, gwlWndProc, proc)
		return value
	}
	value, _, _ := procSetWindowLongW.Call(hwnd, gwlWndProc, proc)
	return value
}

// frameWindowProc 先让 Wails 的窗口过程跑完，再在浮动模式下把边框压掉。
// 顺序不能反：Wails 正是在 WM_ACTIVATE 里重扩玻璃边框的。
func frameWindowProc(hwnd, msg, wparam, lparam uintptr) uintptr {
	ret, _, _ := procCallWindowProcW.Call(frameHookPrev, hwnd, msg, wparam, lparam)
	if !bubbleFrame.Load() {
		return ret
	}
	switch msg {
	case wmActivate, wmDpiChanged:
		extendGlassFrame(hwnd, 0)
	}
	return ret
}

// installFrameHook 把窗口过程换成我们的薄壳。重复调用是安全的：
// 当前过程已经是自己就什么都不做，避免套出多层。
func installFrameHook(native unsafe.Pointer) {
	hwnd := uintptr(native)
	if hwnd == 0 {
		return
	}
	frameHookMu.Lock()
	defer frameHookMu.Unlock()
	if frameHookProc == 0 {
		frameHookProc = windows.NewCallback(frameWindowProc)
	}
	if windowProcOf(hwnd) == frameHookProc {
		return
	}
	frameHookPrev = setWindowProcOf(hwnd, frameHookProc)
}

// setBubbleChrome 去掉浮动球窗口的玻璃边框。92px 的窗口里只有一个圆，
// 1px 的扩框会带出一圈浅色描边和一层变暗的客户区，看起来就是那种
// 「不知道从哪来的方框」。
func setBubbleChrome(native unsafe.Pointer) {
	if native == nil {
		return
	}
	installFrameHook(native)
	bubbleFrame.Store(true)
	extendGlassFrame(uintptr(native), 0)
}

// restoreMainChrome 恢复 Wails 的默认玻璃边框：1px 扩框带来 Aero
// 阴影和 Windows 11 圆角，主窗口需要这两样。
func restoreMainChrome(native unsafe.Pointer) {
	if native == nil {
		return
	}
	installFrameHook(native)
	bubbleFrame.Store(false)
	extendGlassFrame(uintptr(native), 1)
}

// platformBackdropKind 报告透明 webview 背后是否有 Mica 背景。
// Windows 11 22H2（build 22621）是首个支持
// DWMWA_SYSTEMBACKDROP_TYPE 的版本。
func platformBackdropKind() string {
	windowsBackdropOnce.Do(func() {
		version := windows.RtlGetVersion()
		if version.MajorVersion >= 10 && version.BuildNumber >= 22621 {
			windowsBackdropKind = "mica"
			return
		}
		windowsBackdropKind = "none"
	})
	return windowsBackdropKind
}
