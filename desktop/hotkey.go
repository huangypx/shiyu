package desktop

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
)

type hotkeyRegistration struct {
	cmd       *exec.Cmd
	config    string
	stop      chan struct{}
	signals   chan os.Signal
	available bool
	reason    string
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
	if h.signals != nil {
		signal.Stop(h.signals)
	}
	// 非 Linux 平台的注册对象只带有不可用原因，没有可关闭的通道；
	// 直接 close(nil) 会在退出时 panic。
	if h.stop == nil {
		return
	}
	select {
	case <-h.stop:
		return
	default:
		close(h.stop)
	}
	if h.cmd != nil && h.cmd.Process != nil {
		_ = h.cmd.Process.Kill()
	}
	if h.config != "" {
		_ = os.Remove(h.config)
	}
}

func registerHotkey(hotkey string, callback func()) (*hotkeyRegistration, error) {
	if strings.TrimSpace(hotkey) == "" {
		return nil, errors.New("desktop hotkey is empty")
	}
	if runtime.GOOS != "linux" {
		return &hotkeyRegistration{available: false, reason: "global hotkey adapter is not enabled on this platform yet"}, nil
	}
	if strings.TrimSpace(os.Getenv("DISPLAY")) == "" {
		return &hotkeyRegistration{available: false, reason: "X11 DISPLAY is unavailable; use the in-app shortcut or a Wayland portal"}, nil
	}
	xbindkeys, err := exec.LookPath("xbindkeys")
	if err != nil {
		return &hotkeyRegistration{available: false, reason: "install xbindkeys to enable a global shortcut"}, nil
	}
	key, err := xbindKeyExpression(hotkey)
	if err != nil {
		return nil, err
	}
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

func xbindKeyExpression(raw string) (string, error) {
	parts := strings.Split(raw, "+")
	if len(parts) == 0 {
		return "", errors.New("invalid desktop hotkey")
	}
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		key := strings.ToLower(strings.TrimSpace(part))
		switch key {
		case "ctrl", "control":
			key = "control"
		case "cmd", "command", "meta", "super", "win", "windows":
			key = "mod4"
		case "option":
			key = "alt"
		case "space", "return", "enter", "tab", "escape", "esc":
			if key == "esc" {
				key = "escape"
			}
		default:
			if key == "" {
				return "", errors.New("desktop hotkey contains an empty key")
			}
		}
		result = append(result, key)
	}
	return strings.Join(result, "+"), nil
}
