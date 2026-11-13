package desktop

import "github.com/huangypx/shiyu/backend"

// InitialMode 返回启动时应当出现的可见面：bubbleHidden 优先于
// startInBubble，两者都没开时回到主窗口。main.go 还要用它决定启动
// 时的 macOS 激活策略，两处必须共用同一个判据，不能各写一遍。
func InitialMode(cfg backend.DesktopConfig) string {
	switch {
	case cfg.BubbleHidden:
		return ModeHidden
	case cfg.StartInBubble:
		return ModeBubble
	default:
		return ModeMain
	}
}

// dockIconVisibleForMode 决定应用是否出现在 Dock/任务栏里：只有主窗口
// 作为可见面时才是常规应用；只剩悬浮球、胶囊或托盘时进程退化成
// 后台常驻，用户只能从托盘找回界面。
func dockIconVisibleForMode(mode string) bool {
	return mode == ModeMain
}

// syncDockIcon 按可见面同步 Dock 图标。单元测试里 desktop 为 nil：
// 测试进程没有 NSApplication，也不该真的去改激活策略。
func (c *Controller) syncDockIcon(mode string) {
	if c.desktop == nil {
		return
	}
	setDockIconVisible(dockIconVisibleForMode(mode))
}
