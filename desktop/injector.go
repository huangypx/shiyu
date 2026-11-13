//go:build !windows

package desktop

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

// pasteTimeout 限定宿主按键助手的执行时间。macOS 弹出自动化
// 权限提示时 osascript 会一直阻塞，没有超时的话录音流水线
// 会永远等下去。
const pasteTimeout = 8 * time.Second

func canPasteCurrentCursor() bool {
	switch runtime.GOOS {
	case "linux":
		if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
			return false
		}
		_, xdotoolErr := exec.LookPath("xdotool")
		_, wtypeErr := exec.LookPath("wtype")
		return xdotoolErr == nil || wtypeErr == nil
	case "darwin":
		_, err := exec.LookPath("osascript")
		return err == nil
	default:
		return false
	}
}

func activeWindowID() string {
	if runtime.GOOS != "linux" {
		return ""
	}
	path, err := exec.LookPath("xdotool")
	if err != nil {
		return ""
	}
	output, err := exec.Command(path, "getactivewindow").Output()
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(output))
}

func pasteCurrentCursor(targetWindow, _ string) error {
	if runtime.GOOS == "linux" && targetWindow != "" {
		if path, err := exec.LookPath("xdotool"); err == nil {
			if output, activateErr := exec.Command(path, "windowactivate", "--sync", targetWindow).CombinedOutput(); activateErr != nil {
				return fmt.Errorf("restore target application: %w (%s)", activateErr, string(output))
			}
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), pasteTimeout)
	defer cancel()

	var command *exec.Cmd
	switch runtime.GOOS {
	case "linux":
		if path, err := exec.LookPath("wtype"); err == nil {
			command = exec.CommandContext(ctx, path, "-M", "ctrl", "v", "-m", "ctrl")
		} else if path, err := exec.LookPath("xdotool"); err == nil {
			command = exec.CommandContext(ctx, path, "key", "--clearmodifiers", "ctrl+v")
		}
	case "darwin":
		if path, err := exec.LookPath("osascript"); err == nil {
			command = exec.CommandContext(ctx, path, "-e", `tell application "System Events" to keystroke "v" using command down`)
		}
	}
	if command == nil {
		return fmt.Errorf("no host paste injector found; text remains in the clipboard")
	}
	output, err := command.CombinedOutput()
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			return fmt.Errorf("paste into active application timed out after %s; text remains in the clipboard", pasteTimeout)
		}
		return fmt.Errorf("paste into active application: %w (%s)", err, strings.TrimSpace(string(output)))
	}
	return nil
}
