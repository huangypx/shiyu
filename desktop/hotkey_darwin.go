//go:build darwin && cgo

package desktop

/*
#cgo CFLAGS: -fblocks
#cgo LDFLAGS: -framework Carbon
#include <Carbon/Carbon.h>
#include <dispatch/dispatch.h>
#include <pthread.h>

// Carbon 热键是「注册」而不是监听按键事件，不需要辅助功能或
// 输入监控授权。回调由 Go 侧导出（hotkey_darwin_callback.go），
// 这里只声明。
extern void shiyuHotKeyDispatch(void);

static EventHandlerRef shiyuHandlerRef = NULL;
static EventHotKeyRef shiyuHotKeyRef = NULL;

static OSStatus shiyuHotKeyHandler(EventHandlerCallRef next, EventRef event, void *userData) {
	shiyuHotKeyDispatch();
	return noErr;
}

// 注册与注销都跳回主线程：InstallEventHandler 挂在应用事件目标
// 上，与 AppKit 主循环保持一致最稳妥。已经在主线程时直接执行，
// 避免 dispatch_sync 自己等自己。
static void shiyuHotKeyRunOnMain(dispatch_block_t block) {
	if (pthread_main_np()) {
		block();
		return;
	}
	dispatch_sync(dispatch_get_main_queue(), block);
}

static OSStatus shiyuRegisterHotKey(UInt32 keyCode, UInt32 modifiers) {
	__block OSStatus result = noErr;
	shiyuHotKeyRunOnMain(^{
		if (shiyuHandlerRef != NULL || shiyuHotKeyRef != NULL) {
			result = eventHotKeyExistsErr;
			return;
		}
		EventTypeSpec spec;
		spec.eventClass = kEventClassKeyboard;
		spec.eventKind = kEventHotKeyPressed;
		result = InstallEventHandler(GetApplicationEventTarget(), shiyuHotKeyHandler, 1, &spec, NULL, &shiyuHandlerRef);
		if (result != noErr) {
			shiyuHandlerRef = NULL;
			return;
		}
		EventHotKeyID hotKeyID;
		hotKeyID.signature = 'shyu';
		hotKeyID.id = 1;
		result = RegisterEventHotKey(keyCode, modifiers, hotKeyID, GetApplicationEventTarget(), 0, &shiyuHotKeyRef);
		if (result != noErr) {
			RemoveEventHandler(shiyuHandlerRef);
			shiyuHandlerRef = NULL;
			shiyuHotKeyRef = NULL;
		}
	});
	return result;
}

static void shiyuUnregisterHotKey(void) {
	shiyuHotKeyRunOnMain(^{
		if (shiyuHotKeyRef != NULL) {
			UnregisterEventHotKey(shiyuHotKeyRef);
			shiyuHotKeyRef = NULL;
		}
		if (shiyuHandlerRef != NULL) {
			RemoveEventHandler(shiyuHandlerRef);
			shiyuHandlerRef = NULL;
		}
	});
}
*/
import "C"

import (
	"errors"
	"fmt"
	"sync"
)

// 同一时刻只注册一个全局热键（改键先 Stop 再注册），因此回调
// 存在包级变量里，导出入口读它另起 goroutine。
var (
	darwinHotkeyMu       sync.RWMutex
	darwinHotkeyCallback func()
)

// darwinKeyCodes 是 macOS 虚拟键码（kVK_ANSI_* 与功能键），
// 只覆盖 parseHotkeySpec 允许的键表。
var darwinKeyCodes = map[string]uint32{
	"space": 0x31, "enter": 0x24, "tab": 0x30, "escape": 0x35,
	"a": 0x00, "s": 0x01, "d": 0x02, "f": 0x03, "h": 0x04, "g": 0x05,
	"z": 0x06, "x": 0x07, "c": 0x08, "v": 0x09, "b": 0x0B, "q": 0x0C,
	"w": 0x0D, "e": 0x0E, "r": 0x0F, "y": 0x10, "t": 0x11,
	"1": 0x12, "2": 0x13, "3": 0x14, "4": 0x15, "6": 0x16, "5": 0x17,
	"9": 0x19, "7": 0x1A, "8": 0x1C, "0": 0x1D,
	"o": 0x1F, "u": 0x20, "i": 0x22, "p": 0x23, "l": 0x25, "j": 0x26,
	"k": 0x28, "n": 0x2D, "m": 0x2E,
	"f1": 0x7A, "f2": 0x78, "f3": 0x63, "f4": 0x76, "f5": 0x60, "f6": 0x61,
	"f7": 0x62, "f8": 0x64, "f9": 0x65, "f10": 0x6D, "f11": 0x67, "f12": 0x6F,
}

// darwinCarbonModifiers 把掩码翻译成 Carbon 修饰键常量：
// cmdKey=0x0100、shiftKey=0x0200、optionKey=0x0800、controlKey=0x1000。
func darwinCarbonModifiers(mods hotkeyModifiers) uint32 {
	var out uint32
	if mods&modCtrl != 0 {
		out |= 0x1000
	}
	if mods&modShift != 0 {
		out |= 0x0200
	}
	if mods&modAlt != 0 {
		out |= 0x0800
	}
	if mods&modMeta != 0 {
		out |= 0x0100
	}
	return out
}

func registerPlatformHotkey(spec hotkeySpec, callback func()) (*hotkeyRegistration, error) {
	keyCode, ok := darwinKeyCodes[spec.Key]
	if !ok {
		return nil, fmt.Errorf("this key combination is not supported: %s", spec.Key)
	}

	darwinHotkeyMu.Lock()
	darwinHotkeyCallback = callback
	darwinHotkeyMu.Unlock()

	status := int(C.shiyuRegisterHotKey(C.UInt32(keyCode), C.UInt32(darwinCarbonModifiers(spec.Modifiers))))
	if status != 0 {
		darwinHotkeyMu.Lock()
		darwinHotkeyCallback = nil
		darwinHotkeyMu.Unlock()
		// -9868 即 eventHotKeyExistsErr：组合键已被占用（含本进程残留）。
		if status == -9868 {
			return nil, errors.New("another application already owns this shortcut")
		}
		return nil, fmt.Errorf("register global hotkey failed (OSStatus %d)", status)
	}

	registration := &hotkeyRegistration{available: true}
	registration.platformStop = func() {
		C.shiyuUnregisterHotKey()
		darwinHotkeyMu.Lock()
		darwinHotkeyCallback = nil
		darwinHotkeyMu.Unlock()
	}
	return registration, nil
}
