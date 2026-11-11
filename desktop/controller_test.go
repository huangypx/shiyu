package desktop

import (
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestControllerRequiresStartupForWindowMode(t *testing.T) {
	controller := NewController(nil, nil, nil)
	if err := controller.SetMode(ModeBubble); err == nil {
		t.Fatal("expected SetMode to require Wails startup")
	}
	state := controller.GetState()
	if state.Mode != ModeMain {
		t.Fatalf("initial mode = %q, want %q", state.Mode, ModeMain)
	}
	if state.Platform != runtime.GOOS {
		t.Fatalf("platform = %q, want %q", state.Platform, runtime.GOOS)
	}
	switch state.Backdrop {
	case "glass", "vibrancy", "mica", "none":
	default:
		t.Fatalf("unexpected backdrop %q", state.Backdrop)
	}
}

func TestWindowCommandsRequireStartup(t *testing.T) {
	controller := NewController(nil, nil, nil)
	if err := controller.SaveBubblePosition(); err == nil {
		t.Fatal("expected SaveBubblePosition to require Wails startup")
	}
	if err := controller.HideWindow(); err == nil {
		t.Fatal("expected HideWindow to require Wails startup")
	}
	if err := controller.OpenSettings(); err == nil {
		t.Fatal("expected OpenSettings to require Wails startup")
	}
	if err := controller.MinimiseWindow(); err == nil {
		t.Fatal("expected MinimiseWindow to require Wails startup")
	}
	if err := controller.ToggleMaximiseWindow(); err == nil {
		t.Fatal("expected ToggleMaximiseWindow to require Wails startup")
	}
	if controller.IsWindowMaximised() {
		t.Fatal("expected IsWindowMaximised to report false before startup")
	}
}

func TestClampPointKeepsBubbleInsideWorkArea(t *testing.T) {
	area := application.Rect{X: 100, Y: 50, Width: 1000, Height: 800}

	if got := clampPoint(point{X: -40, Y: -20}, area); got != (point{X: 100, Y: 50}) {
		t.Fatalf("negative position clamped to %+v, want the work area origin", got)
	}

	want := point{X: area.X + area.Width - bubbleWidth, Y: area.Y + area.Height - bubbleHeight}
	if got := clampPoint(point{X: 5000, Y: 5000}, area); got != want {
		t.Fatalf("oversized position clamped to %+v, want %+v", got, want)
	}

	inside := point{X: 400, Y: 300}
	if got := clampPoint(inside, area); got != inside {
		t.Fatalf("inside position moved to %+v, want %+v", got, inside)
	}
}

func TestRectContainsOnlyAcceptsInteriorPoints(t *testing.T) {
	area := application.Rect{X: 10, Y: 20, Width: 100, Height: 80}
	if !rectContains(area, point{X: 10, Y: 20}) {
		t.Fatal("top-left corner must be inside the work area")
	}
	if rectContains(area, point{X: 110, Y: 50}) {
		t.Fatal("right edge must be outside the half-open work area")
	}
	if rectContains(area, point{X: 50, Y: 100}) {
		t.Fatal("bottom edge must be outside the half-open work area")
	}
}
