//go:build !linux

package desktop

import "os"

// 非 Linux 平台上 notifyHotkeySignal 是空实现：registerHotkey
// 在启动 xbindkeys 前就返回了，不会收到信号。
func notifyHotkeySignal(chan os.Signal) {}
