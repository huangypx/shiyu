//go:build !windows && !linux && (!darwin || !cgo)

package desktop

func focusedInputTarget() string { return "" }
