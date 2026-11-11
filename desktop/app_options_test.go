package desktop

import (
	"runtime"
	"testing"

	"github.com/wailsapp/wails/v3/pkg/application"
)

func TestNewWindowOptionsFollowsHost(t *testing.T) {
	opts := NewWindowOptions(true)

	if opts.Hidden {
		t.Fatal("the window must be visible so WKWebView can initialize")
	}
	if opts.Width != bubbleWidth || opts.Height != bubbleHeight {
		t.Fatalf("StartInBubble size = %dx%d, want %dx%d", opts.Width, opts.Height, bubbleWidth, bubbleHeight)
	}
	if opts.BackgroundType != application.BackgroundTypeTransparent {
		t.Fatalf("background type = %v, want transparent", opts.BackgroundType)
	}
	if opts.BackgroundColour != application.NewRGBA(0, 0, 0, 0) {
		t.Fatalf("background colour = %+v, want fully transparent", opts.BackgroundColour)
	}
	switch runtime.GOOS {
	case "darwin":
		if opts.Frameless {
			t.Fatal("macOS must keep the titled window so native traffic lights exist")
		}
		if opts.Mac.TitleBar != application.MacTitleBarHidden {
			t.Fatalf("macOS title bar = %+v, want MacTitleBarHidden", opts.Mac.TitleBar)
		}
		if opts.Mac.Backdrop != application.MacBackdropTransparent {
			t.Fatalf("macOS backdrop = %v, want MacBackdropTransparent", opts.Mac.Backdrop)
		}
	case "windows", "linux":
		if !opts.Frameless {
			t.Fatalf("%s must stay frameless so the window can shrink to 92x92", runtime.GOOS)
		}
	}
}

func TestNewWindowOptionsStartsVisibleByDefault(t *testing.T) {
	opts := NewWindowOptions(false)
	if opts.Hidden {
		t.Fatal("the main window must be visible unless StartInBubble is set")
	}
}
