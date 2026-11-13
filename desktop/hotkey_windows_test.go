//go:build windows

package desktop

import "testing"

func TestWindowsVirtualKeysCoverKeyTable(t *testing.T) {
	for _, key := range hotkeyKeyTable() {
		if _, ok := windowsVirtualKey(key); !ok {
			t.Errorf("windows virtual key missing for %q", key)
		}
	}
}

func TestWindowsVirtualKeyValues(t *testing.T) {
	tests := map[string]uint32{
		"space":  0x20,
		"enter":  0x0D,
		"tab":    0x09,
		"escape": 0x1B,
		"a":      0x41,
		"z":      0x5A,
		"0":      0x30,
		"9":      0x39,
		"f1":     0x70,
		"f12":    0x7B,
	}
	for key, want := range tests {
		if got, ok := windowsVirtualKey(key); !ok || got != want {
			t.Errorf("windowsVirtualKey(%q) = %#x/%v, want %#x", key, got, ok, want)
		}
	}
}

func TestWindowsModifiers(t *testing.T) {
	got := windowsModifiers(modAlt)
	if got != winModAlt|winModNoRepeat {
		t.Errorf("windowsModifiers(modAlt) = %#x, want %#x", got, winModAlt|winModNoRepeat)
	}
	got = windowsModifiers(modCtrl | modShift | modMeta)
	want := uint32(winModControl | winModShift | winModWin | winModNoRepeat)
	if got != want {
		t.Errorf("windowsModifiers(ctrl|shift|meta) = %#x, want %#x", got, want)
	}
}
