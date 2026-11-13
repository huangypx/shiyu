package desktop

import "fmt"

// RequestClose 统一处理系统关闭事件和自绘标题栏的关闭按钮。
// 托盘常驻，关闭主窗口不等于退出：默认弹出确认框让用户选择。
func (c *Controller) RequestClose() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	action := "ask"
	if c.app != nil {
		action = c.app.GetDesktopConfig().CloseAction
	}
	if action == "" {
		action = "ask"
	}
	c.mu.Lock()
	if c.closePending {
		c.mu.Unlock()
		return nil
	}
	if action == "ask" {
		c.closePending = true
	}
	mode := c.mode
	transitioning := c.transitioning
	c.mu.Unlock()
	if action == "ask" {
		// 确认框要在可见的主窗口上弹出；球/隐藏/最小化/动画先恢复主窗口。
		if transitioning || mode != ModeMain || !c.window.IsVisible() || c.window.IsMinimised() {
			return c.ShowMainWindow()
		}
		c.emitState()
		return nil
	}
	return c.applyCloseAction(action)
}

// ResolveClose 先保存用户勾选的偏好，写入失败时保留弹窗供重试。
// action 为 cancel/background/quit；remember 时把选择写回 CloseAction。
func (c *Controller) ResolveClose(action string, remember bool) error {
	c.closeMu.Lock()
	defer c.closeMu.Unlock()
	c.mu.RLock()
	pending := c.closePending
	c.mu.RUnlock()
	if !pending {
		return nil
	}
	if action != "cancel" && action != "background" && action != "quit" {
		return fmt.Errorf("unknown close action %q", action)
	}
	if remember && action != "cancel" {
		if c.app == nil {
			return fmt.Errorf("backend app is not configured")
		}
		cfg := c.app.GetDesktopConfig()
		cfg.CloseAction = action
		if err := c.app.SaveDesktopConfig(cfg); err != nil {
			return err
		}
	}
	c.mu.Lock()
	c.closePending = false
	c.mu.Unlock()
	if action == "cancel" {
		c.emitState()
		return nil
	}
	return c.applyCloseAction(action)
}

// applyCloseAction 执行关闭选择：quit 退出进程，background 收成悬浮球
// 后台运行（托盘常驻，进程不退出）。
func (c *Controller) applyCloseAction(action string) error {
	if action == "quit" {
		c.Quit()
		return nil
	}
	return c.SetMode(ModeBubble)
}
