package desktop

import (
	"strconv"
	"testing"
)

func TestParseHotkeySpec(t *testing.T) {
	tests := []struct {
		raw   string
		mods  hotkeyModifiers
		key   string
		linux string
	}{
		{"Option+Space", modAlt, "space", "alt+space"},
		{"Alt+Space", modAlt, "space", "alt+space"},
		{"Ctrl+Shift+Space", modCtrl | modShift, "space", "control+shift+space"},
		{"Cmd+Alt+K", modMeta | modAlt, "k", "mod4+alt+k"},
		{"Ctrl+Esc", modCtrl, "escape", "control+escape"},
		{"Control+Return", modCtrl, "enter", "control+enter"},
		{"Meta+F5", modMeta, "f5", "mod4+f5"},
		{"Win+Shift+Tab", modMeta | modShift, "tab", "mod4+shift+tab"},
		{" option + space ", modAlt, "space", "alt+space"},
	}
	for _, tt := range tests {
		spec, err := parseHotkeySpec(tt.raw)
		if err != nil {
			t.Fatalf("parseHotkeySpec(%q): %v", tt.raw, err)
		}
		if spec.Modifiers != tt.mods {
			t.Errorf("parseHotkeySpec(%q) modifiers = %b, want %b", tt.raw, spec.Modifiers, tt.mods)
		}
		if spec.Key != tt.key {
			t.Errorf("parseHotkeySpec(%q) key = %q, want %q", tt.raw, spec.Key, tt.key)
		}
		if got := spec.linuxExpression(); got != tt.linux {
			t.Errorf("parseHotkeySpec(%q).linuxExpression() = %q, want %q", tt.raw, got, tt.linux)
		}
	}
}

func TestParseHotkeySpecRejects(t *testing.T) {
	for _, raw := range []string{
		"",
		"   ",
		"Space",
		"Ctrl++Space",
		"Ctrl+Foo",
		"Ctrl+Shift",
		"Ctrl+F13",
		"Ctrl+F0",
		"Hyper+K",
	} {
		if _, err := parseHotkeySpec(raw); err == nil {
			t.Errorf("parseHotkeySpec(%q) succeeded, want error", raw)
		}
	}
}

// hotkeyKeyTable 列出 parseHotkeySpec 接受的全部键名，
// 平台适配器的键码表必须完整覆盖它。
func hotkeyKeyTable() []string {
	keys := []string{"space", "enter", "tab", "escape"}
	for ch := 'a'; ch <= 'z'; ch++ {
		keys = append(keys, string(ch))
	}
	for ch := '0'; ch <= '9'; ch++ {
		keys = append(keys, string(ch))
	}
	for n := 1; n <= 12; n++ {
		keys = append(keys, "f"+strconv.Itoa(n))
	}
	return keys
}
