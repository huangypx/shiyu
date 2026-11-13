//go:build !darwin || !cgo

package desktop

import "unsafe"

// startBubbleHoverTracking 在非 macOS/cgo 平台是空实现：其他窗口
// 后端通常会把 hover 派发给非激活窗口；macOS 没有 cgo 时无法挂
// 原生 tracking area，悬停只在窗口获得焦点时生效。
func startBubbleHoverTracking(unsafe.Pointer) {}

// stopBubbleHoverTracking 与空实现配对：调用方不必判断平台。
func stopBubbleHoverTracking(unsafe.Pointer) {}
