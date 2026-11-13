//go:build windows

package desktop

import (
	"errors"
	"fmt"
	"runtime"
	"strconv"
	"syscall"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	hotkeyKernel32 = windows.NewLazySystemDLL("kernel32.dll")

	procRegisterHotKey     = user32.NewProc("RegisterHotKey")
	procUnregisterHotKey   = user32.NewProc("UnregisterHotKey")
	procGetMessageW        = user32.NewProc("GetMessageW")
	procPostThreadMessageW = user32.NewProc("PostThreadMessageW")
	procGetCurrentThreadId = hotkeyKernel32.NewProc("GetCurrentThreadId")
)

const (
	wmHotkey = 0x0312
	wmQuit   = 0x0012

	winModAlt     = 0x0001
	winModControl = 0x0002
	winModShift   = 0x0004
	winModWin     = 0x0008
	// MOD_NOREPEAT：按住不放时只触发一次，避免长按刷屏。
	winModNoRepeat = 0x4000

	errorHotkeyAlreadyRegistered = 1409
)

// winMsg 与 Win32 MSG 同布局，Go 的自然对齐在 32/64 位下
// 都与系统结构一致。
type winMsg struct {
	hwnd    uintptr
	message uint32
	wParam  uintptr
	lParam  uintptr
	time    uint32
	pt      struct{ x, y int32 }
}

// windowsHotkeyThread 持有注册线程的 ID 与收尾通道。注销必须
// 回到注册线程执行，跨线程 UnregisterHotKey 会失败并泄漏热键。
type windowsHotkeyThread struct {
	id   uint32
	done chan struct{}
}

func windowsVirtualKey(key string) (uint32, bool) {
	switch key {
	case "space":
		return 0x20, true
	case "enter":
		return 0x0D, true
	case "tab":
		return 0x09, true
	case "escape":
		return 0x1B, true
	}
	if len(key) == 1 {
		ch := key[0]
		if ch >= 'a' && ch <= 'z' {
			return uint32(ch-'a') + 0x41, true
		}
		if ch >= '0' && ch <= '9' {
			return uint32(ch-'0') + 0x30, true
		}
	}
	if len(key) >= 2 && key[0] == 'f' {
		if n, err := strconv.Atoi(key[1:]); err == nil && n >= 1 && n <= 12 {
			return uint32(n) + 0x6F, true
		}
	}
	return 0, false
}

func windowsModifiers(mods hotkeyModifiers) uint32 {
	out := uint32(winModNoRepeat)
	if mods&modCtrl != 0 {
		out |= winModControl
	}
	if mods&modShift != 0 {
		out |= winModShift
	}
	if mods&modAlt != 0 {
		out |= winModAlt
	}
	if mods&modMeta != 0 {
		out |= winModWin
	}
	return out
}

func registerPlatformHotkey(spec hotkeySpec, callback func()) (*hotkeyRegistration, error) {
	vk, ok := windowsVirtualKey(spec.Key)
	if !ok {
		return nil, fmt.Errorf("this key combination is not supported: %s", spec.Key)
	}
	mods := windowsModifiers(spec.Modifiers)

	thread := &windowsHotkeyThread{done: make(chan struct{})}
	ready := make(chan error, 1)
	go func() {
		// RegisterHotKey(NULL, ...) 把 WM_HOTKEY 投递到注册线程的
		// 消息队列，因此注册、取消息、注销必须锁在同一根线程上，
		// 与 Wails 的主消息循环完全隔离。
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(thread.done)

		tid, _, _ := procGetCurrentThreadId.Call()
		thread.id = uint32(tid)
		ret, _, callErr := procRegisterHotKey.Call(0, 1, uintptr(mods), uintptr(vk))
		if ret == 0 {
			if errno, ok := callErr.(syscall.Errno); ok && errno == errorHotkeyAlreadyRegistered {
				ready <- errors.New("another application already owns this shortcut")
			} else {
				ready <- fmt.Errorf("register global hotkey: %w", callErr)
			}
			return
		}
		ready <- nil

		var msg winMsg
		for {
			ret, _, _ := procGetMessageW.Call(uintptr(unsafe.Pointer(&msg)), 0, 0, 0)
			// 0 是 WM_QUIT，-1 是错误；两种都退出循环并注销。
			if int32(ret) <= 0 {
				break
			}
			if msg.message == wmHotkey {
				go callback()
			}
		}
		procUnregisterHotKey.Call(0, 1)
	}()

	if err := <-ready; err != nil {
		<-thread.done
		return nil, err
	}
	registration := &hotkeyRegistration{available: true}
	registration.platformStop = func() {
		procPostThreadMessageW.Call(uintptr(thread.id), wmQuit, 0, 0)
		<-thread.done
	}
	return registration, nil
}
