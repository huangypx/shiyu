//go:build linux

package desktop

import (
	"os"
	"os/signal"
	"syscall"
)

// notifyHotkeySignal 接上 SIGUSR1：xbindkeys 助手通过它把
// 信号发回进程，用来触发录音。
func notifyHotkeySignal(ch chan os.Signal) {
	signal.Notify(ch, syscall.SIGUSR1)
}
