//go:build darwin && cgo

package desktop

import "testing"

func TestDarwinKeyCodesCoverKeyTable(t *testing.T) {
	for _, key := range hotkeyKeyTable() {
		if _, ok := darwinKeyCodes[key]; !ok {
			t.Errorf("darwin key code missing for %q", key)
		}
	}
}

func TestDarwinCarbonModifiers(t *testing.T) {
	tests := []struct {
		mods hotkeyModifiers
		want uint32
	}{
		{modAlt, 0x0800},
		{modCtrl | modShift, 0x1000 | 0x0200},
		{modMeta, 0x0100},
		{modCtrl | modShift | modAlt | modMeta, 0x1000 | 0x0200 | 0x0800 | 0x0100},
	}
	for _, tt := range tests {
		if got := darwinCarbonModifiers(tt.mods); got != tt.want {
			t.Errorf("darwinCarbonModifiers(%b) = %#x, want %#x", tt.mods, got, tt.want)
		}
	}
}
