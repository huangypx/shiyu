package desktop

import (
	"path/filepath"
	"runtime"
	"testing"
	"testing/synctest"
	"time"

	"github.com/huangypx/shiyu/backend"
	"github.com/wailsapp/wails/v3/pkg/application"
)

type memoryClipboard struct{ text string }

func (m *memoryClipboard) Text() (string, bool) { return m.text, true }
func (m *memoryClipboard) SetText(value string) bool {
	m.text = value
	return true
}

func TestPasteRestoresOnlyItsOwnClipboardWrite(t *testing.T) {
	for _, tc := range []struct {
		name     string
		restore  bool
		copyAt   time.Duration
		external bool
		want     string
	}{
		{name: "ordinary paste", restore: true, want: "previous"},
		{name: "restore disabled", want: "result"},
		{name: "copy identical result", restore: true, copyAt: time.Second, want: "result"},
		{name: "copy while restore runs", restore: true, copyAt: 1500 * time.Millisecond, want: "result"},
		{name: "another app writes", restore: true, external: true, want: "external"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				clip := &memoryClipboard{text: "previous"}
				controller := &Controller{clipboard: clip}
				err := controller.pasteWithClipboard("result", "", tc.restore, func() error {
					if clip.text != "result" {
						t.Fatalf("clipboard at injection = %q", clip.text)
					}
					return nil
				})
				if err != nil {
					t.Fatal(err)
				}
				if tc.copyAt > 0 {
					time.AfterFunc(tc.copyAt, func() {
						if err := controller.CopyText("result"); err != nil {
							t.Error(err)
						}
					})
				}
				if tc.external {
					clip.SetText("external")
				}
				time.Sleep(2 * time.Second)
				synctest.Wait()
				if clip.text != tc.want {
					t.Fatalf("clipboard after timer = %q, want %q", clip.text, tc.want)
				}
			})
		})
	}
}

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

func TestConfigureHotkeyWithoutGlobalShortcut(t *testing.T) {
	t.Setenv("DISPLAY", "")
	app, err := backend.NewApp(filepath.Join(t.TempDir(), "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	controller := NewController(app, nil, nil)
	if err := controller.ServiceStartup(t.Context(), application.ServiceOptions{}); err != nil {
		t.Fatal(err)
	}
	for _, hotkey := range []string{app.GetDesktopConfig().Hotkey, "Ctrl+Alt+R"} {
		if err := controller.ConfigureHotkey(hotkey); err != nil {
			t.Fatal(err)
		}
		state := controller.GetState()
		if state.Hotkey != hotkey || state.HotkeyRegistered || state.HotkeyReason == "" {
			t.Fatalf("unexpected hotkey state: %+v", state)
		}
	}
	if err := controller.ServiceShutdown(); err != nil {
		t.Fatal(err)
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

	want := point{X: area.X + area.Width - bubbleSize, Y: area.Y + area.Height - bubbleSize}
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

func TestBubbleExpandsAroundBottomAnchor(t *testing.T) {
	area := application.Rect{X: -1200, Y: 0, Width: 1200, Height: 860}
	anchor := point{X: -628, Y: 784}
	for _, size := range [][2]int{{56, 56}, {150, 56}, {360, 160}} {
		rect := bubbleBounds(anchor, area, size[0], size[1])
		if rect.X+rect.Width/2 != -600 || rect.Y+rect.Height != 840 {
			t.Fatalf("bubble moved away from anchor: %+v", rect)
		}
	}
	rect := bubbleBounds(point{X: -55, Y: 2}, area, 360, 160)
	if rect.X != -360 || rect.Y != 0 {
		t.Fatalf("expanded bubble clipped by monitor edge: %+v", rect)
	}
}
