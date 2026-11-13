package desktop

import (
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestControllerRequiresStartupForWindowMode(t *testing.T) {
	controller := NewController(nil, nil)
	if err := controller.EnterBubble(); err == nil {
		t.Fatal("expected EnterBubble to require Wails startup")
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
	controller := NewController(nil, nil)
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

func TestPublishSessionRejectsUnknownStage(t *testing.T) {
	controller := NewController(nil, nil)
	if err := controller.PublishSession(SessionState{Stage: "nope"}); err == nil {
		t.Fatal("expected unknown session stage to be rejected")
	}
}

func TestPublishSessionAcceptsIdleDraftEdits(t *testing.T) {
	controller := NewController(nil, nil)
	if err := controller.PublishSession(SessionState{
		Status:     "idle",
		Transcript: "草稿",
	}); err != nil {
		t.Fatal(err)
	}
	session := controller.GetSession()
	if session.Status != "idle" || session.Transcript != "草稿" {
		t.Fatalf("session = %+v", session)
	}
	if session.Revision != 1 {
		t.Fatalf("revision = %d, want 1", session.Revision)
	}
	if session.Host != ModeOverlay {
		t.Fatalf("host = %q, want overlay", session.Host)
	}
}

func TestPublishSessionRejectsEditsWhileActive(t *testing.T) {
	controller := NewController(nil, nil)
	controller.publishSessionState(SessionState{Status: "recording"})
	if err := controller.PublishSession(SessionState{Transcript: "x"}); err == nil {
		t.Fatal("expected active session edits to be rejected")
	}
}

func TestPublishSessionStateIncrementsRevision(t *testing.T) {
	controller := NewController(nil, nil)
	controller.publishSessionState(SessionState{Status: "recording"})
	controller.publishSessionState(SessionState{Status: "processing"})
	session := controller.GetSession()
	if session.Revision != 2 {
		t.Fatalf("revision = %d, want 2", session.Revision)
	}
	if session.Host != ModeOverlay {
		t.Fatalf("host = %q, want overlay", session.Host)
	}
}

func TestNormalizeModeMapsEmptyToHidden(t *testing.T) {
	if got := normalizeMode(""); got != ModeHidden {
		t.Fatalf("empty mode normalized to %q, want %q", got, ModeHidden)
	}
	if got := normalizeMode(ModeBubble); got != ModeBubble {
		t.Fatalf("bubble mode normalized to %q, want %q", got, ModeBubble)
	}
}

func TestMainCloseOnlyNeedsConfirmationForCurrentWindow(t *testing.T) {
	controller := NewController(nil, nil)
	current := &application.WebviewWindow{}
	stale := &application.WebviewWindow{}
	controller.windows[ModeMain] = current

	if !controller.isCurrentMainWindow(current) {
		t.Fatal("the registered main window must be treated as current")
	}
	if controller.isCurrentMainWindow(stale) {
		t.Fatal("a detached main window must be allowed to close without asking")
	}

	delete(controller.windows, ModeMain)
	if controller.isCurrentMainWindow(current) {
		t.Fatal("an unregistered window must not be treated as current")
	}
}

func TestClampPointKeepsBubbleInsideWorkArea(t *testing.T) {
	area := applicationRect(100, 50, 1000, 800)

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
	area := applicationRect(10, 20, 100, 80)
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
