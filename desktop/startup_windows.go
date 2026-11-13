package desktop

import (
	"errors"
	"fmt"

	"golang.org/x/sys/windows/registry"
)

const startupRegistryPath = `Software\Microsoft\Windows\CurrentVersion\Run`
const startupRegistryName = "Shiyu"

func setLaunchAtLogin(enabled bool) error {
	var executable string
	if enabled {
		var err error
		executable, err = startupExecutable()
		if err != nil {
			return err
		}
	}
	return writeLaunchAtLogin(startupRegistryPath, executable, enabled)
}

func writeLaunchAtLogin(keyPath, executable string, enabled bool) error {
	if enabled {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.SET_VALUE)
		if err != nil {
			return fmt.Errorf("open startup settings: %w", err)
		}
		defer key.Close()
		return key.SetStringValue(startupRegistryName, `"`+executable+`" --background`)
	}
	key, err := registry.OpenKey(registry.CURRENT_USER, keyPath, registry.SET_VALUE)
	if errors.Is(err, registry.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("open startup settings: %w", err)
	}
	defer key.Close()
	if err := key.DeleteValue(startupRegistryName); err != nil && !errors.Is(err, registry.ErrNotExist) {
		return fmt.Errorf("disable launch at login: %w", err)
	}
	return nil
}
