package desktop

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/w32"
)

func TestRightAltTapDoesNotReleaseAltIntoEditor(t *testing.T) {
	binding := &rightAltBinding{held: true, wake: make(chan struct{}, 1)}
	key := &w32.KBDLLHOOKSTRUCT{VkCode: w32.VK_RMENU}
	if !binding.handle(w32.WM_SYSKEYDOWN, key) || binding.taps.Load() != 0 {
		t.Fatal("repeated down must be consumed without toggling")
	}
	if !binding.handle(w32.WM_SYSKEYUP, key) || binding.taps.Load() != 1 {
		t.Fatal("standalone release must toggle once and stay out of the foreground menu")
	}
	if binding.handle(w32.WM_SYSKEYUP, key) || binding.taps.Load() != 1 {
		t.Fatal("a release without a matching press must pass through")
	}
	binding.held, binding.chord, binding.forwarded = true, true, true
	if binding.handle(w32.WM_SYSKEYUP, key) || binding.taps.Load() != 1 {
		t.Fatal("the editor must receive the modifier release for a forwarded combination")
	}
}
