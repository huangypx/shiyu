package backend

import (
	"runtime"
	"testing"
)

func TestDefaultHotkeyFor(t *testing.T) {
	tests := map[string]string{
		"darwin":  "Option+Space",
		"windows": "Alt+Space",
		"linux":   "Ctrl+Shift+Space",
		"freebsd": "Ctrl+Shift+Space",
	}
	for goos, want := range tests {
		if got := defaultHotkeyFor(goos); got != want {
			t.Errorf("defaultHotkeyFor(%q) = %q, want %q", goos, got, want)
		}
	}
}

func TestDefaultConfigHotkeyMatchesPlatform(t *testing.T) {
	cfg := DefaultConfig()
	if got, want := cfg.Desktop.Hotkey, defaultHotkeyFor(runtime.GOOS); got != want {
		t.Errorf("DefaultConfig().Desktop.Hotkey = %q, want %q", got, want)
	}
}

func TestDesktopApplyDefaultsKeepsSavedHotkey(t *testing.T) {
	// 平台默认值变更不能覆盖用户已保存的组合键。
	d := DesktopConfig{Hotkey: "Ctrl+Shift+Space"}
	d.applyDefaults(DefaultConfig().Desktop)
	if d.Hotkey != "Ctrl+Shift+Space" {
		t.Errorf("saved hotkey was overwritten: %q", d.Hotkey)
	}
	empty := DesktopConfig{}
	empty.applyDefaults(DefaultConfig().Desktop)
	if empty.Hotkey != defaultHotkeyFor(runtime.GOOS) {
		t.Errorf("empty hotkey = %q, want platform default", empty.Hotkey)
	}
}
