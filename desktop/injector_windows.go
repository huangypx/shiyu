package desktop

import (
	"fmt"
	"strconv"
	"strings"
	"unsafe"

	"github.com/wailsapp/wails/v3/pkg/w32"
	"golang.org/x/sys/windows"
)

var sendKeyboardInput = windows.NewLazySystemDLL("user32.dll").NewProc("SendInput")

const (
	inputKeyboard = 1
	keyExtended   = 1
	keyReleased   = 2
	keyUnicode    = 4
)

// Windows 的 INPUT 是联合体，键盘事件也要传入容纳鼠标事件的完整结构大小。
type keyboardInput struct {
	kind uint32
	key  w32.KEYBDINPUT
	pad  [unsafe.Sizeof(w32.MOUSEINPUT{}) - unsafe.Sizeof(w32.KEYBDINPUT{})]byte
}

func sendKeyboardInputs(keys []keyboardInput) (int, error) {
	n, _, err := sendKeyboardInput.Call(uintptr(len(keys)), uintptr(unsafe.Pointer(&keys[0])), unsafe.Sizeof(keys[0]))
	if n != uintptr(len(keys)) {
		if err == windows.ERROR_SUCCESS {
			return int(n), fmt.Errorf("Windows accepted %d of %d keyboard events", n, len(keys))
		}
		return int(n), fmt.Errorf("send keyboard events: %w", err)
	}
	return int(n), nil
}

func canPasteCurrentCursor() bool { return true }

func activeWindowID() string { return "" }

func pasteCurrentCursor(_ string, expectedInput string) error {
	if expectedInput != "" {
		window, _, ok := strings.Cut(expectedInput, "/")
		if !ok || window != strconv.FormatUint(uint64(w32.GetForegroundWindow()), 10) {
			return errInputChanged
		}
	}
	keys := [...]keyboardInput{
		{kind: inputKeyboard, key: w32.KEYBDINPUT{WVk: w32.VK_CONTROL}},
		{kind: inputKeyboard, key: w32.KEYBDINPUT{WVk: 'V'}},
		{kind: inputKeyboard, key: w32.KEYBDINPUT{WVk: 'V', DwFlags: keyReleased}},
		{kind: inputKeyboard, key: w32.KEYBDINPUT{WVk: w32.VK_CONTROL, DwFlags: keyReleased}},
	}
	_, err := sendKeyboardInputs(keys[:])
	return err
}
