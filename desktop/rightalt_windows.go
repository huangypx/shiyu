package desktop

import (
	"errors"
	"fmt"
	"runtime"
	"sync/atomic"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

const rightAltReplayTag = 0x53485955

var (
	installKeyboardHook = windows.NewLazySystemDLL("user32.dll").NewProc("SetWindowsHookExW")
	rightAltProc        = windows.NewCallback(rightAltEvent)
	currentRightAlt     atomic.Pointer[rightAltBinding]
)

type rightAltBinding struct {
	held, chord, forwarded bool
	taps                   atomic.Uint32
	wake                   chan struct{}
}

func rightAltEvent(code int32, message uintptr, key *w32.KBDLLHOOKSTRUCT) uintptr {
	binding := currentRightAlt.Load()
	if code == 0 && binding != nil && key != nil && key.DwExtraInfo != rightAltReplayTag &&
		binding.handle(message, key) {
		return 1
	}
	return uintptr(w32.CallNextHookEx(0, int(code), w32.WPARAM(message), w32.LPARAM(uintptr(unsafe.Pointer(key)))))
}

func (b *rightAltBinding) handle(message uintptr, key *w32.KBDLLHOOKSTRUCT) bool {
	down := message == w32.WM_KEYDOWN || message == w32.WM_SYSKEYDOWN
	up := message == w32.WM_KEYUP || message == w32.WM_SYSKEYUP
	rightAlt := key.VkCode == w32.VK_RMENU || (key.VkCode == w32.VK_MENU && key.Flags&keyExtended != 0)
	if rightAlt && down {
		if !b.held {
			b.held = true
			// 已在使用其他修饰键的组合照常交给系统。AltGr 自带的左 Ctrl 允许随后组合。
			b.forwarded = w32.GetAsyncKeyState(w32.VK_SHIFT)&0x8000 != 0 ||
				w32.GetAsyncKeyState(w32.VK_RCONTROL)&0x8000 != 0 ||
				w32.GetAsyncKeyState(w32.VK_LMENU)&0x8000 != 0 ||
				w32.GetAsyncKeyState(w32.VK_LWIN)&0x8000 != 0 || w32.GetAsyncKeyState(w32.VK_RWIN)&0x8000 != 0
			b.chord = b.forwarded
		}
		return !b.forwarded
	}
	if !b.held {
		return false
	}
	if rightAlt && up {
		consume := !b.forwarded
		if !b.chord {
			// 单击的按下和松开都由拾语接收，前台编辑器不会因此进入菜单模式。
			b.taps.Add(1)
			select {
			case b.wake <- struct{}{}:
			default:
			}
		}
		b.held, b.chord, b.forwarded = false, false, false
		return consume
	}
	if !rightAlt && down && !b.chord {
		b.chord = true
		// 出现组合键时才补发右 Alt 和首个组合按键，后续按键与松开由系统直接处理。
		other := w32.KEYBDINPUT{
			WVk: uint16(key.VkCode), WScan: uint16(key.ScanCode),
			DwFlags: uint32(key.Flags) & keyExtended, DwExtraInfo: rightAltReplayTag,
		}
		if key.VkCode == 0xe7 { // Unicode 输入使用扫描码携带字符。
			other.WVk, other.DwFlags = 0, keyUnicode
		}
		keys := [...]keyboardInput{
			{kind: inputKeyboard, key: w32.KEYBDINPUT{
				WVk: w32.VK_RMENU, WScan: 0x38, DwFlags: keyExtended, DwExtraInfo: rightAltReplayTag,
			}},
			{kind: inputKeyboard, key: other},
		}
		n, _ := sendKeyboardInputs(keys[:])
		b.forwarded = n > 0
		return n == len(keys)
	}
	return false
}

func registerRightAlt(key string, callback func()) (*hotkeyRegistration, error) {
	binding := &rightAltBinding{wake: make(chan struct{}, 1)}
	if !currentRightAlt.CompareAndSwap(nil, binding) {
		return nil, errors.New("Right Alt is already registered")
	}
	ready := make(chan error, 1)
	done := make(chan struct{})
	var thread w32.HANDLE
	go func() {
		runtime.LockOSThread()
		defer runtime.UnlockOSThread()
		defer close(done)
		defer currentRightAlt.CompareAndSwap(binding, nil)
		var msg w32.MSG
		w32.PeekMessage(&msg, 0, 0, 0, w32.PM_NOREMOVE)
		thread = w32.GetCurrentThreadId()
		hook, _, err := installKeyboardHook.Call(w32.WH_KEYBOARD_LL, rightAltProc, uintptr(w32.GetModuleHandle("")), 0)
		if hook == 0 {
			ready <- fmt.Errorf("register Right Alt: %w", err)
			return
		}
		defer w32.UnhookWindowsHookEx(w32.HHOOK(hook))
		ready <- nil
		// 独立消息循环保持按键响应；查询输入框和录音都在另一条协程进行。
		for int32(w32.GetMessage(&msg, 0, 0, 0)) > 0 {
			w32.TranslateMessage(&msg)
			w32.DispatchMessage(&msg)
		}
	}()
	if err := <-ready; err != nil {
		<-done
		return nil, err
	}
	reg := &hotkeyRegistration{key: key, available: true, stop: make(chan struct{})}
	reg.unbind = func() {
		w32.PostThreadMessage(thread, w32.WM_QUIT, 0, 0)
		<-done
	}
	go func() {
		for {
			select {
			case <-binding.wake:
				for n := binding.taps.Swap(0); n > 0 && currentRightAlt.Load() == binding; n-- {
					callback()
				}
			case <-reg.stop:
				return
			}
		}
	}()
	return reg, nil
}
