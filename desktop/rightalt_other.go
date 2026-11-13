//go:build !windows

package desktop

import "errors"

func registerRightAlt(_ string, _ func()) (*hotkeyRegistration, error) {
	return nil, errors.New("Right Alt as a global shortcut requires Windows")
}
