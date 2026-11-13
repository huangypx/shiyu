package desktop

import (
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func applicationRect(x, y, width, height int) application.Rect {
	return application.Rect{X: x, Y: y, Width: width, Height: height}
}

func TestBubbleTargetBoundsUsesSavedPointAndClamps(t *testing.T) {
	area := applicationRect(100, 50, 1200, 800)
	saved := point{X: 400, Y: 300}
	got := bubbleTargetBounds(area, &saved)
	if got != (application.Rect{X: 400, Y: 300, Width: bubbleWidth, Height: bubbleHeight}) {
		t.Fatalf("saved bubble bounds = %+v", got)
	}

	outside := point{X: 5000, Y: -500}
	got = bubbleTargetBounds(area, &outside)
	want := application.Rect{
		X:      area.X + area.Width - bubbleWidth,
		Y:      area.Y,
		Width:  bubbleWidth,
		Height: bubbleHeight,
	}
	if got != want {
		t.Fatalf("clamped bubble bounds = %+v, want %+v", got, want)
	}
}

func TestBubbleTargetBoundsLeavesRoomForToolbar(t *testing.T) {
	area := applicationRect(0, 0, 1200, 800)
	got := bubbleTargetBounds(area, nil)
	if got.Height != bubbleHeight || got.Height <= bubbleWidth {
		t.Fatalf("bubble height = %d, want %d with toolbar room", got.Height, bubbleHeight)
	}
	if got.Y+got.Height > area.Height {
		t.Fatalf("default bubble bounds %+v escaped work area %+v", got, area)
	}
}

func TestCenteredRectUsesWorkArea(t *testing.T) {
	area := applicationRect(100, 50, 1440, 900)
	got := centeredRect(area, mainWidth, mainHeight)
	want := application.Rect{
		X:      area.X + (area.Width-mainWidth)/2,
		Y:      area.Y + (area.Height-mainHeight)/2,
		Width:  mainWidth,
		Height: mainHeight,
	}
	if got != want {
		t.Fatalf("centered rect = %+v, want %+v", got, want)
	}
}

func TestClampRectToWorkAreaKeepsRememberedWindow(t *testing.T) {
	area := applicationRect(0, 0, 1440, 900)
	remembered := applicationRect(220, 80, 760, 700)
	if got := clampRectToWorkArea(remembered, area); got != remembered {
		t.Fatalf("inside bounds moved to %+v, want %+v", got, remembered)
	}

	offScreen := applicationRect(1340, 850, 760, 700)
	got := clampRectToWorkArea(offScreen, area)
	if got.X+got.Width > area.X+area.Width || got.Y+got.Height > area.Y+area.Height {
		t.Fatalf("restored bounds %+v escaped work area %+v", got, area)
	}
}

func TestBubbleWindowOptionsAreIndependentTransparentWindow(t *testing.T) {
	controller := NewController(nil, nil)
	rect := applicationRect(200, 300, bubbleWidth, bubbleHeight)
	opts := controller.bubbleWindowOptions(rect)

	if opts.Name != ModeBubble || opts.URL != "/?view=bubble" {
		t.Fatalf("bubble window identity = %q %q", opts.Name, opts.URL)
	}
	if opts.Width != bubbleWidth || opts.Height != bubbleHeight {
		t.Fatalf("bubble size = %dx%d", opts.Width, opts.Height)
	}
	if !opts.Frameless || !opts.DisableResize || !opts.AlwaysOnTop {
		t.Fatalf("bubble must be frameless, fixed and on top: %+v", opts)
	}
	if opts.BackgroundType != application.BackgroundTypeTransparent {
		t.Fatalf("bubble background = %v", opts.BackgroundType)
	}
	if opts.X != rect.X || opts.Y != rect.Y {
		t.Fatalf("bubble position = %d,%d want %d,%d", opts.X, opts.Y, rect.X, rect.Y)
	}
	if runtime.GOOS == "windows" && !opts.Windows.HiddenOnTaskbar {
		t.Fatal("bubble should stay out of the Windows taskbar")
	}
}

func TestOverlayWindowOptionsAreNonActivatingPanel(t *testing.T) {
	controller := NewController(nil, nil)
	rect := applicationRect(0, 600, overlayWidth, overlayHeight)
	opts := controller.overlayWindowOptions(rect)

	if opts.Name != ModeOverlay || opts.URL != "/?view=overlay" {
		t.Fatalf("overlay window identity = %q %q", opts.Name, opts.URL)
	}
	if !opts.Frameless || !opts.DisableResize || !opts.AlwaysOnTop {
		t.Fatalf("overlay must be frameless, fixed and on top: %+v", opts)
	}
	if runtime.GOOS == "darwin" {
		if opts.Mac.WindowClass != application.MacWindowClassPanel {
			t.Fatalf("macOS overlay class = %v, want panel", opts.Mac.WindowClass)
		}
		if !opts.Mac.PanelPreferences.NonActivating {
			t.Fatal("macOS overlay must not activate the app")
		}
	}
	if runtime.GOOS == "windows" && opts.Windows.ExStyle&windowsExNoActivate == 0 {
		t.Fatal("Windows overlay must carry WS_EX_NOACTIVATE")
	}
}

func TestMainWindowOptionsKeepTitledChromeOnMac(t *testing.T) {
	controller := NewController(nil, nil)
	rect := applicationRect(100, 100, mainWidth, mainHeight)
	opts := controller.mainWindowOptions(rect)

	if opts.Name != ModeMain || opts.URL != "/" {
		t.Fatalf("main window identity = %q %q", opts.Name, opts.URL)
	}
	if opts.Width != mainWidth || opts.Height != mainHeight {
		t.Fatalf("main size = %dx%d", opts.Width, opts.Height)
	}
	if runtime.GOOS == "darwin" {
		if opts.Frameless {
			t.Fatal("macOS main window must keep the titled frame")
		}
		if opts.Mac.TitleBar != application.MacTitleBarHidden {
			t.Fatalf("macOS title bar = %+v", opts.Mac.TitleBar)
		}
	} else if !opts.Frameless {
		t.Fatalf("%s main window must be frameless", runtime.GOOS)
	}
}
