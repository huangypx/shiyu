//go:build !darwin && !windows

package desktop

import "github.com/wailsapp/wails/v3/pkg/application"

// traySupported：Linux 桌面环境托盘协议不统一（StatusNotifier 与
// XEmbed 并存，部分发行版默认无托盘），这里不装配托盘。
// SetBubbleHidden(true) 会因此被拒绝，避免隐藏悬浮球后无从恢复。
func traySupported() bool { return false }

func trayLeftClickOpensMenu() bool { return false }

func trayApplyIcon(*application.SystemTray) {}
