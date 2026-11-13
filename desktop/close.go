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
	c.mu.Unlock()

	switch action {
	case "ask":
		c.mu.Lock()
		c.closePending = true
		c.mu.Unlock()
		// 确认框在主窗口里显示；主窗口可能刚被收起或隐藏。
		if err := c.ShowMainWindow(); err != nil {
			c.mu.Lock()
			c.closePending = false
			c.mu.Unlock()
			return err
		}
		c.emitState()
		return nil
	case "quit":
		c.Quit()
		return nil
	default:
		return c.EnterBubble()
	}
}

// ResolveClose 先保存用户勾选的偏好，写入失败时保留弹窗供重试。
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

	switch action {
	case "cancel":
		c.emitState()
		return nil
	case "quit":
		c.Quit()
		return nil
	default:
		return c.EnterBubble()
	}
}
