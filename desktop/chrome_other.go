//go:build !darwin && !windows

package desktop

import "unsafe"

func setBubbleChrome(unsafe.Pointer) {}

func restoreMainChrome(unsafe.Pointer) {}

func platformBackdropKind() string { return "none" }
