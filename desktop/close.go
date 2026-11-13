package desktop

import (
	"fmt"

	"github.com/huangypx/shiyu/backend"
)

// RequestClose 统一处理系统关闭事件和自绘标题栏的关闭按钮。
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
	if action == "ask" {
		// 确认框接管正在收起的窗口，动画末帧不能再把它切回后台。
		c.layoutMu.Lock()
		defer c.layoutMu.Unlock()
	}
	c.mu.Lock()
	if c.closePending || c.quitting {
		c.mu.Unlock()
		return nil
	}
	if action == "ask" {
		c.closePending = true
	}
	mode := c.mode
	shrinking := c.shrinkCancel != nil
	c.mu.Unlock()
	if action == "ask" {
		if shrinking || mode == ModeBubble || !c.window.IsVisible() || c.window.IsMinimised() {
			return c.showMainWindowLocked()
		}
		c.emitState()
		return nil
	}
	return c.applyCloseAction(action)
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
		if err := backend.UpdateDesktopConfig(c.app, func(cfg *backend.DesktopConfig) {
			cfg.CloseAction = action
		}); err != nil {
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

func (c *Controller) applyCloseAction(action string) error {
	if action == "quit" {
		c.Quit()
		return nil
	}
	return c.SetMode(ModeBubble)
}
