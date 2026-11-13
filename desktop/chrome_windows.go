//go:build windows

package desktop

import (
	"sync"
	"sync/atomic"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/w32"
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
	bubbleHwnd          w32.HWND
	mainFrame           uint32

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

// setBubbleChrome 去掉胶囊外的玻璃边框，并让点击胶囊时焦点留在原输入框。
func setBubbleChrome(native unsafe.Pointer) {
	if native == nil {
		return
	}
	application.InvokeSync(func() {
		hwnd := w32.HWND(uintptr(native))
		installFrameHook(native)
		bubbleFrame.Store(true)
		if bubbleHwnd != hwnd {
			// 系统标题栏的最小宽度会把胶囊撑开，展开主窗口时再恢复原样式。
			style := uint32(w32.GetWindowLong(hwnd, w32.GWL_STYLE))
			mainFrame = style & (w32.WS_OVERLAPPEDWINDOW | w32.WS_POPUP)
			bubbleHwnd = hwnd
			w32.SetWindowLong(hwnd, w32.GWL_STYLE, style&^w32.WS_OVERLAPPEDWINDOW|w32.WS_POPUP)
			ext := uint32(w32.GetWindowLong(hwnd, w32.GWL_EXSTYLE))
			w32.SetWindowLong(hwnd, w32.GWL_EXSTYLE, ext|w32.WS_EX_NOACTIVATE)
			refreshWindowFrame(hwnd)
		}
		extendGlassFrame(uintptr(native), 0)
	})
}

// restoreMainChrome 恢复 Wails 的默认玻璃边框：1px 扩框带来 Aero
// 阴影和 Windows 11 圆角，主窗口需要这两样。
func restoreMainChrome(native unsafe.Pointer) {
	if native == nil {
		return
	}
	application.InvokeSync(func() {
		hwnd := w32.HWND(uintptr(native))
		installFrameHook(native)
		bubbleFrame.Store(false)
		if hwnd == bubbleHwnd {
			bubbleHwnd = 0
			style := uint32(w32.GetWindowLong(hwnd, w32.GWL_STYLE))
			w32.SetWindowLong(hwnd, w32.GWL_STYLE, style&^(w32.WS_OVERLAPPEDWINDOW|w32.WS_POPUP)|mainFrame)
			ext := uint32(w32.GetWindowLong(hwnd, w32.GWL_EXSTYLE))
			w32.SetWindowLong(hwnd, w32.GWL_EXSTYLE, ext&^w32.WS_EX_NOACTIVATE)
			refreshWindowFrame(hwnd)
		}
		extendGlassFrame(uintptr(native), 1)
	})
}

func refreshWindowFrame(hwnd w32.HWND) {
	w32.SetWindowPos(hwnd, 0, 0, 0, 0, 0, w32.SWP_NOMOVE|w32.SWP_NOSIZE|w32.SWP_NOZORDER|w32.SWP_NOACTIVATE|w32.SWP_FRAMECHANGED)
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
