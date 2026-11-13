package desktop

import (
	"math"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	// transitionShrink 与 transitionExpand 同时是发给前端的方向值，
	// 前端据此决定水滴从主窗口还是从悬浮球开始。
	transitionShrink = "shrink"
	transitionExpand = "expand"

	// 手动收起时先让主界面淡出，以免用户看见缩小过程中的响应式重排。
	// 展开时主窗口直接回到原位置，前端独立完成淡入。
	shrinkLeadIn    = 160 * time.Millisecond
	expandLeadIn    = 160 * time.Millisecond
	shrinkDuration  = 300 * time.Millisecond
	transitionFrame = time.Second / 60

	anchorTopLeft  = "top-left"
	anchorTopRight = "top-right"
)

// windowBounds 是发给前端的窗口矩形。单独定义而不是复用
// application.Rect，是为了让事件载荷保持小写 JSON 字段，和
// State、DesktopState 的命名习惯一致。
type windowBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type transitionEvent struct {
	Direction  string `json:"direction"`
	DurationMs int    `json:"durationMs"`
	// Anchor 只对收起有意义，展开时前端不画水滴。
	Anchor string       `json:"anchor"`
	From   windowBounds `json:"from"`
	To     windowBounds `json:"to"`
}

func boundsFromRect(rect application.Rect) windowBounds {
	return windowBounds{
		X:      rect.X,
		Y:      rect.Y,
		Width:  rect.Width,
		Height: rect.Height,
	}
}

func clampFloat(value, low, high float64) float64 {
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}

// easeInOutCubic 先加速后减速，用于收起：窗口离开屏幕时有一点
// 惯性，落点又不会砸在悬浮球上。
func easeInOutCubic(t float64) float64 {
	t = clampFloat(t, 0, 1)
	if t < 0.5 {
		return 4 * t * t * t
	}
	return 1 - math.Pow(-2*t+2, 3)/2
}

func interpolateBounds(from, to application.Rect, t float64) application.Rect {
	if t <= 0 {
		return from
	}
	if t >= 1 {
		return to
	}
	return application.Rect{
		X:      int(math.Round(float64(from.X) + float64(to.X-from.X)*t)),
		Y:      int(math.Round(float64(from.Y) + float64(to.Y-from.Y)*t)),
		Width:  int(math.Round(float64(from.Width) + float64(to.Width-from.Width)*t)),
		Height: int(math.Round(float64(from.Height) + float64(to.Height-from.Height)*t)),
	}
}

// bubbleTargetBounds 让不同宽高的内容共用球心和底边，默认位于屏幕下方中央。
func bubbleTargetBounds(area application.Rect, saved *point, width, height int) application.Rect {
	position := point{
		X: area.X + (area.Width-bubbleSize)/2,
		Y: area.Y + area.Height - bubbleSize - bubbleBottomInset,
	}
	if saved != nil {
		position = *saved
	}
	return bubbleBounds(position, area, width, height)
}

// bubbleAnchor 决定收起时水滴贴住悬浮球的哪一侧。球固定在浮动窗
// 顶部，纵向必须贴顶才能和球重合；横向按球中心与主窗口中心的
// 左右关系取靠主窗口的一侧。展开时窗口直接回到上次的位置。
func bubbleAnchor(centerX, referenceX int) string {
	if centerX > referenceX {
		return anchorTopRight
	}
	return anchorTopLeft
}

func centeredRect(area application.Rect, width, height int) application.Rect {
	return application.Rect{
		X:      area.X + (area.Width-width)/2,
		Y:      area.Y + (area.Height-height)/2,
		Width:  width,
		Height: height,
	}
}

// clampRectToWorkArea 保证恢复的主窗口不会因为换屏或分辨率变化
// 被放到工作区外。工作区比窗口小时优先服从工作区。
func clampRectToWorkArea(rect, area application.Rect) application.Rect {
	width := rect.Width
	height := rect.Height
	if width <= 0 {
		width = mainWidth
	}
	if height <= 0 {
		height = mainHeight
	}
	if width > area.Width {
		width = area.Width
	}
	if height > area.Height {
		height = area.Height
	}
	return application.Rect{
		X:      clampInt(rect.X, area.X, area.X+area.Width-width),
		Y:      clampInt(rect.Y, area.Y, area.Y+area.Height-height),
		Width:  width,
		Height: height,
	}
}

// SetReduceMotion 同步用户的系统偏好，让原生窗口与网页一起减少动效。
func (c *Controller) SetReduceMotion(enabled bool) error {
	c.mu.Lock()
	c.reduceMotion = enabled
	c.mu.Unlock()
	return nil
}

func (c *Controller) rememberMainBounds(bounds application.Rect) {
	if bounds.Width >= mainMinWidth && bounds.Height >= mainMinHeight {
		c.lastMainBounds = bounds
	}
}

func (c *Controller) trackMainBounds(_ *application.WindowEvent) {
	// 程序调整窗口期间会收到相同事件，中间帧不能覆盖用户的位置。
	if !c.layoutMu.TryLock() {
		return
	}
	defer c.layoutMu.Unlock()
	c.mu.RLock()
	main := c.mode == ModeMain && c.shrinkCancel == nil && !c.quitting
	c.mu.RUnlock()
	if main && c.window.IsVisible() && !c.window.IsMinimised() {
		c.rememberMainBounds(c.window.Bounds())
	}
}

func (c *Controller) restoreMainTarget() application.Rect {
	last := c.lastMainBounds
	if last.Width > 0 {
		center := point{X: last.X + last.Width/2, Y: last.Y + last.Height/2}
		if screen := c.screenAt(center); screen != nil {
			return clampRectToWorkArea(last, screen.WorkArea)
		}
	}
	area := application.Rect{Width: 1440, Height: 900}
	if screen := c.windowScreen(); screen != nil {
		area = screen.WorkArea
	}
	return clampRectToWorkArea(centeredRect(area, mainWidth, mainHeight), area)
}

func (c *Controller) emitTransition(direction string, from, to application.Rect, duration time.Duration) {
	if c.desktop == nil {
		return
	}
	c.desktop.Event.Emit("desktop:transition", transitionEvent{
		Direction: direction, DurationMs: int(duration.Milliseconds()),
		Anchor: bubbleAnchor(to.X+to.Width/2, from.X+from.Width/2),
		From:   boundsFromRect(from), To: boundsFromRect(to),
	})
}

// cancelShrinkLocked 在持有 mu 时调用。返回值用于避免把动画中间帧记作主窗口位置。
func (c *Controller) cancelShrinkLocked() bool {
	if c.shrinkCancel == nil {
		return false
	}
	close(c.shrinkCancel)
	c.shrinkCancel = nil
	return true
}

// beginShrink 仅由用户手动收起主窗口触发。后台失焦、最小化及录音仍然立即切换。
func (c *Controller) beginShrink(from, to application.Rect) {
	c.mu.Lock()
	if c.quitting || c.closePending {
		c.mu.Unlock()
		return
	}
	cancel := make(chan struct{})
	c.shrinkCancel = cancel
	c.mu.Unlock()

	c.rememberMainBounds(from)
	c.applyBubbleChrome(c.window)
	c.window.SetMinSize(0, 0)
	from = c.window.Bounds()
	c.emitTransition(transitionShrink, from, to, shrinkDuration)
	go c.runShrink(from, to, cancel)
}

func (c *Controller) runShrink(from, to application.Rect, cancel <-chan struct{}) {
	select {
	case <-time.After(shrinkLeadIn):
	case <-cancel:
		return
	}

	// 每一帧单独锁定布局，快捷键、关闭和托盘操作可以立即接管窗口。
	move := func(bounds application.Rect) {
		c.layoutMu.Lock()
		defer c.layoutMu.Unlock()
		select {
		case <-cancel:
		default:
			setNativeWindowBounds(c.window, bounds)
		}
	}
	if !animateWindowBounds(from, to, shrinkDuration, easeInOutCubic, move, cancel) {
		return
	}
	c.layoutMu.Lock()
	defer c.layoutMu.Unlock()
	select {
	case <-cancel:
	default:
		_ = c.setModeLocked(ModeBubble)
	}
}

// animateWindowBounds 在 duration 内把窗口从 from 插值到 to。
// setBounds 每帧调用一次；cancel 关闭时立即返回 false，调用方
// 不应再提交最终状态。ticker 丢帧时用绝对时间计算 t，不会因为
// 某次 SetFrame 慢了一拍就把动画整体拖长。
func animateWindowBounds(
	from, to application.Rect,
	duration time.Duration,
	ease func(float64) float64,
	setBounds func(application.Rect),
	cancel <-chan struct{},
) bool {
	if duration <= 0 || from == to {
		setBounds(to)
		return true
	}

	setBounds(from)
	start := time.Now()
	ticker := time.NewTicker(transitionFrame)
	defer ticker.Stop()

	for {
		select {
		case <-cancel:
			return false
		case now := <-ticker.C:
			t := float64(now.Sub(start)) / float64(duration)
			if t >= 1 {
				setBounds(to)
				return true
			}
			setBounds(interpolateBounds(from, to, ease(t)))
		}
	}
}
