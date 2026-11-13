package desktop

import (
	"testing"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestInterpolateBoundsEndpoints(t *testing.T) {
	from := application.Rect{X: 10, Y: 20, Width: 1000, Height: 820}
	to := application.Rect{X: 300, Y: 400, Width: 92, Height: 92}

	if got := interpolateBounds(from, to, 0); got != from {
		t.Fatalf("t=0 bounds = %+v, want %+v", got, from)
	}
	if got := interpolateBounds(from, to, 1); got != to {
		t.Fatalf("t=1 bounds = %+v, want %+v", got, to)
	}

	mid := interpolateBounds(from, to, 0.5)
	if mid.Width != 546 || mid.Height != 456 {
		t.Fatalf("mid bounds = %+v, want width 546 height 456", mid)
	}
}

func TestEaseInOutCubicStaysInRangeAndMonotonic(t *testing.T) {
	ease := easeInOutCubic
	if got := ease(0); got != 0 {
		t.Fatalf("ease(0) = %v, want 0", got)
	}
	if got := ease(1); got != 1 {
		t.Fatalf("ease(1) = %v, want 1", got)
	}
	previous := 0.0
	for step := 1; step <= 20; step++ {
		value := ease(float64(step) / 20)
		if value < previous {
			t.Fatalf("ease is not monotonic at %d/20: %v < %v", step, value, previous)
		}
		if value < 0 || value > 1 {
			t.Fatalf("ease(%d/20) = %v, out of range", step, value)
		}
		previous = value
	}
}

func TestBubbleTargetBoundsUsesSavedPointAndClamps(t *testing.T) {
	area := application.Rect{X: 100, Y: 50, Width: 1200, Height: 800}
	saved := point{X: 400, Y: 300}
	got := bubbleTargetBounds(area, &saved, bubbleSize, bubbleSize)
	if got != (application.Rect{X: 400, Y: 300, Width: bubbleSize, Height: bubbleSize}) {
		t.Fatalf("saved bubble bounds = %+v", got)
	}

	outside := point{X: 5000, Y: -500}
	got = bubbleTargetBounds(area, &outside, bubbleSize, bubbleSize)
	want := application.Rect{
		X:      area.X + area.Width - bubbleSize,
		Y:      area.Y,
		Width:  bubbleSize,
		Height: bubbleSize,
	}
	if got != want {
		t.Fatalf("clamped bubble bounds = %+v, want %+v", got, want)
	}
}

func TestBubbleTargetBoundsCentersRecordingAndResultAboveBottomInset(t *testing.T) {
	area := application.Rect{X: -1200, Y: 100, Width: 1200, Height: 800}
	for _, size := range [][2]int{{bubbleSize, bubbleSize}, {150, 56}, {360, 160}} {
		got := bubbleTargetBounds(area, nil, size[0], size[1])
		want := application.Rect{
			X: area.X + (area.Width-size[0])/2, Y: area.Y + area.Height - bubbleBottomInset - size[1],
			Width: size[0], Height: size[1],
		}
		if got != want {
			t.Fatalf("default bubble bounds = %+v, want %+v", got, want)
		}
	}
}

func TestBubbleAnchorFollowsMainWindowSide(t *testing.T) {
	if got := bubbleAnchor(800, 700); got != anchorTopRight {
		t.Fatalf("right anchor = %q, want %q", got, anchorTopRight)
	}
	if got := bubbleAnchor(600, 700); got != anchorTopLeft {
		t.Fatalf("left anchor = %q, want %q", got, anchorTopLeft)
	}
}

func TestCenteredRectUsesWorkArea(t *testing.T) {
	area := application.Rect{X: 100, Y: 50, Width: 1440, Height: 900}
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
	area := application.Rect{X: 0, Y: 0, Width: 1440, Height: 900}
	remembered := application.Rect{X: 220, Y: 80, Width: 760, Height: 700}
	if got := clampRectToWorkArea(remembered, area); got != remembered {
		t.Fatalf("inside bounds moved to %+v, want %+v", got, remembered)
	}

	offScreen := application.Rect{X: 1340, Y: 850, Width: 760, Height: 700}
	got := clampRectToWorkArea(offScreen, area)
	if got.X+got.Width > area.X+area.Width || got.Y+got.Height > area.Y+area.Height {
		t.Fatalf("restored bounds %+v escaped work area %+v", got, area)
	}
}

func TestAnimateWindowBoundsCompletesAtTarget(t *testing.T) {
	from := application.Rect{X: 10, Y: 20, Width: 1000, Height: 820}
	to := application.Rect{X: 300, Y: 400, Width: 92, Height: 92}
	var frames []application.Rect

	done := animateWindowBounds(from, to, 2*time.Millisecond, easeInOutCubic, func(bounds application.Rect) {
		frames = append(frames, bounds)
	}, nil)

	if !done {
		t.Fatal("animation was cancelled")
	}
	if len(frames) < 2 {
		t.Fatalf("expected at least start and end frames, got %d", len(frames))
	}
	if frames[0] != from {
		t.Fatalf("first frame = %+v, want %+v", frames[0], from)
	}
	if frames[len(frames)-1] != to {
		t.Fatalf("last frame = %+v, want %+v", frames[len(frames)-1], to)
	}
}

func TestAnimateWindowBoundsHonorsCancel(t *testing.T) {
	cancelled := make(chan struct{})
	close(cancelled)

	done := animateWindowBounds(
		application.Rect{X: 0, Y: 0, Width: 1000, Height: 820},
		application.Rect{X: 0, Y: 0, Width: 92, Height: 92},
		50*time.Millisecond,
		easeInOutCubic,
		func(application.Rect) {},
		cancelled,
	)
	if done {
		t.Fatal("cancelled animation reported completion")
	}
}

func TestSetReduceMotionDoesNotRequireRuntime(t *testing.T) {
	controller := NewController(nil, nil, nil)
	if err := controller.SetReduceMotion(true); err != nil {
		t.Fatalf("SetReduceMotion returned error: %v", err)
	}
}
