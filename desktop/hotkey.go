package desktop

import (
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"sync"
)

// hotkeyRegistration 是一次全局热键注册的句柄。Linux 走外部
// xbindkeys 进程（cmd/config/stop/signals），macOS 与 Windows 走
// 平台适配器（platformStop）。stopOnce 保证 Stop 幂等：改键与
// 退出流程都可能重复调用。
type hotkeyRegistration struct {
	cmd          *exec.Cmd
	config       string
	stop         chan struct{}
	signals      chan os.Signal
	platformStop func()
	stopOnce     sync.Once
	available    bool
	reason       string
}

func (h *hotkeyRegistration) Available() bool { return h != nil && h.available }
func (h *hotkeyRegistration) Reason() string {
	if h == nil {
		return ""
	}
	return h.reason
}

func (h *hotkeyRegistration) Stop() {
	if h == nil {
		return
	}
	h.stopOnce.Do(func() {
		if h.platformStop != nil {
			h.platformStop()
		}
		if h.signals != nil {
			signal.Stop(h.signals)
		}
		// 不可用注册对象只带有原因，没有可关闭的通道；
		// 直接 close(nil) 会在退出时 panic。
		if h.stop == nil {
			return
		}
		close(h.stop)
		if h.cmd != nil && h.cmd.Process != nil {
			_ = h.cmd.Process.Kill()
		}
		if h.config != "" {
			_ = os.Remove(h.config)
		}
	})
}

// registerHotkey 解析键位后按平台分派：Linux 用可选的 xbindkeys，
// macOS 用 Carbon，Windows 用 RegisterHotKey，其余平台返回不可用
// 原因，前端继续用窗口内快捷键兜底。
func registerHotkey(hotkey string, callback func()) (*hotkeyRegistration, error) {
	spec, err := parseHotkeySpec(hotkey)
	if err != nil {
		return nil, err
	}
	if runtime.GOOS == "linux" {
		return registerLinuxHotkey(spec, callback)
	}
	return registerPlatformHotkey(spec, callback)
}

func registerLinuxHotkey(spec hotkeySpec, callback func()) (*hotkeyRegistration, error) {
	if strings.TrimSpace(os.Getenv("DISPLAY")) == "" {
		return &hotkeyRegistration{available: false, reason: "X11 DISPLAY is unavailable; use the in-app shortcut or a Wayland portal"}, nil
	}
	xbindkeys, err := exec.LookPath("xbindkeys")
	if err != nil {
		return &hotkeyRegistration{available: false, reason: "install xbindkeys to enable a global shortcut"}, nil
	}
	key := spec.linuxExpression()
	file, err := os.CreateTemp("", "shiyu-xbindkeys-*.conf")
	if err != nil {
		return nil, fmt.Errorf("create global hotkey config: %w", err)
	}
	config := file.Name()
	if err := file.Chmod(0o600); err != nil {
		_ = file.Close()
		_ = os.Remove(config)
		return nil, fmt.Errorf("protect global hotkey config: %w", err)
	}
	pid := strconv.Itoa(os.Getpid())
	if _, err := fmt.Fprintf(file, "\"kill -USR1 %s\"\n  %s\n", pid, key); err != nil {
		_ = file.Close()
		_ = os.Remove(config)
		return nil, fmt.Errorf("write global hotkey config: %w", err)
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(config)
		return nil, fmt.Errorf("close global hotkey config: %w", err)
	}

	registration := &hotkeyRegistration{
		cmd:       exec.Command(xbindkeys, "--nodaemon", "--file", config),
		config:    config,
		stop:      make(chan struct{}),
		signals:   make(chan os.Signal, 1),
		available: true,
	}
	registration.cmd.Stdout = nil
	registration.cmd.Stderr = nil
	if err := registration.cmd.Start(); err != nil {
		_ = os.Remove(config)
		return nil, fmt.Errorf("start xbindkeys: %w", err)
	}
	go func() { _ = registration.cmd.Wait() }()
	notifyHotkeySignal(registration.signals)
	go func() {
		for {
			select {
			case <-registration.signals:
				callback()
			case <-registration.stop:
				return
			}
		}
	}()
	return registration, nil
}

// xbindKeyExpression 委托共享解析，保持 Linux 表达式的输出与
// 旧版一致（修饰键顺序跟随用户输入）。
func xbindKeyExpression(raw string) (string, error) {
	spec, err := parseHotkeySpec(raw)
	if err != nil {
		return "", err
	}
	return spec.linuxExpression(), nil
}
