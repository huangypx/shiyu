//go:build !windows

package desktop

import "errors"

func setLaunchAtLogin(enabled bool) error {
	if enabled {
		return errors.New("launch at login is only available on Windows")
	}
	return nil
}
