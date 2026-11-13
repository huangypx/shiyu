package desktop

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestOverlayTargetBoundsBottomCenter(t *testing.T) {
	area := application.Rect{X: 0, Y: 0, Width: 1440, Height: 900}
	got := overlayTargetBounds(area)
	want := application.Rect{
		X:      (1440 - overlayWidth) / 2,
		Y:      900 - overlayHeight - overlayBottomInset,
		Width:  overlayWidth,
		Height: overlayHeight,
	}
	if got != want {
		t.Fatalf("overlay bounds = %+v, want %+v", got, want)
	}
}

func TestOverlayTargetBoundsRespectsWorkAreaOrigin(t *testing.T) {
	// 副屏工作区原点非零：胶囊必须落在该屏底部居中，而不是主屏坐标。
	area := application.Rect{X: 1440, Y: -200, Width: 1920, Height: 1080}
	got := overlayTargetBounds(area)
	if got.X != area.X+(area.Width-overlayWidth)/2 {
		t.Fatalf("overlay X = %d, want bottom-center of secondary screen", got.X)
	}
	if got.Y != area.Y+area.Height-overlayHeight-overlayBottomInset {
		t.Fatalf("overlay Y = %d, want inset from secondary screen bottom", got.Y)
	}
}

func TestOverlayTargetBoundsClampsToSmallWorkArea(t *testing.T) {
	// 工作区比胶囊还窄/还矮时服从工作区，不落到屏幕外。
	area := application.Rect{X: 0, Y: 0, Width: 200, Height: 100}
	got := overlayTargetBounds(area)
	if got.X < area.X || got.Y < area.Y {
		t.Fatalf("overlay escaped work area origin: %+v", got)
	}
	if got.X+got.Width > area.X+area.Width || got.Y+got.Height > area.Y+area.Height {
		t.Fatalf("overlay escaped work area extent: %+v", got)
	}
	if got.Width > area.Width || got.Height > area.Height {
		t.Fatalf("overlay larger than work area: %+v", got)
	}
}
