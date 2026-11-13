package desktop

import (
	"testing"

	"github.com/huangypx/shiyu/backend"
)

func TestDockIconVisibleOnlyWithMainWindow(t *testing.T) {
	cases := []struct {
		mode string
		want bool
	}{
		{ModeMain, true},
		{ModeBubble, false},
		{ModeOverlay, false},
		{ModeHidden, false},
		{"", false},
	}
	for _, tc := range cases {
		if got := dockIconVisibleForMode(tc.mode); got != tc.want {
			t.Fatalf("dock icon for mode %q = %v, want %v", tc.mode, got, tc.want)
		}
	}
}

func TestInitialModeFollowsDesktopConfig(t *testing.T) {
	// bubbleHidden 优先：用户明确只留托盘时，startInBubble 不该再建悬浮球。
	hiding := backend.DesktopConfig{BubbleHidden: true, StartInBubble: true}
	if got := InitialMode(hiding); got != ModeHidden {
		t.Fatalf("initial mode with bubble hidden = %q, want %q", got, ModeHidden)
	}
	if got := InitialMode(backend.DesktopConfig{StartInBubble: true}); got != ModeBubble {
		t.Fatalf("initial mode with start in bubble = %q, want %q", got, ModeBubble)
	}
	if got := InitialMode(backend.DesktopConfig{}); got != ModeMain {
		t.Fatalf("default initial mode = %q, want %q", got, ModeMain)
	}
}
