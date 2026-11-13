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
	"sync"

	"github.com/wailsapp/wails/v3/pkg/application"
)

type hotkeyRegistration struct {
	once      sync.Once
	unbind    func()
	key       string
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
	h.once.Do(func() {
		if h.unbind != nil {
			h.unbind()
		}
		if h.signals != nil {
			signal.Stop(h.signals)
		}
		if h.stop != nil {
			close(h.stop)
		}
		if h.cmd != nil && h.cmd.Process != nil {
			_ = h.cmd.Process.Kill()
		}
		if h.config != "" {
			_ = os.Remove(h.config)
		}
	})
}

func registerHotkey(host *application.App, hotkey string, callback func()) (*hotkeyRegistration, error) {
	if strings.TrimSpace(hotkey) == "" {
		return nil, errors.New("desktop hotkey is empty")
	}
	if host != nil {
		switch strings.ToLower(strings.Join(strings.Fields(hotkey), "")) {
		case "rightalt", "altright", "右alt":
			return registerRightAlt(hotkey, callback)
		}
	}
	if host != nil && (runtime.GOOS != "linux" || os.Getenv("WAYLAND_DISPLAY") != "" || os.Getenv("DISPLAY") == "") {
		parts := strings.Split(hotkey, "+")
		for i, part := range parts {
			parts[i] = strings.ToLower(strings.TrimSpace(part))
			switch parts[i] {
			case "control":
				parts[i] = "ctrl"
			case "win", "windows", "meta":
				parts[i] = "super"
			case "esc":
				parts[i] = "escape"
			case "return":
				parts[i] = "enter"
			}
		}
		accelerator := strings.Join(parts, "+")
		if err := host.GlobalShortcut.Register(accelerator, callback); err != nil {
			return nil, err
		}
		return &hotkeyRegistration{key: hotkey, available: true, unbind: func() {
			_ = host.GlobalShortcut.Unregister(accelerator)
		}}, nil
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
		key:       hotkey,
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
