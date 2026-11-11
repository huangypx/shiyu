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

	// 收起时必须等主界面先淡出，否则窗口一开始缩小就会触发
	// 滚动条和响应式重排。展开时先让悬浮球淡出，再把原生窗口
	// 直接放回主窗口位置；窗口本身不在屏幕上滑动。
	shrinkLeadIn    = 160 * time.Millisecond
	expandLeadIn    = 160 * time.Millisecond
	shrinkDuration  = 300 * time.Millisecond
	transitionFrame = time.Second / 60

	anchorTopLeft     = "top-left"
	anchorTopRight    = "top-right"
	anchorBottomLeft  = "bottom-left"
	anchorBottomRight = "bottom-right"
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

// bubbleTargetBounds 计算悬浮球的目标矩形。area 是悬浮球所在屏幕
// 的工作区；saved 是用户上次拖到的位置，必须已经确认仍落在某块
// 屏幕上，否则传 nil 走默认右下角。
func bubbleTargetBounds(area application.Rect, saved *point) application.Rect {
	position := point{
		X: area.X + area.Width - bubbleSize - bubbleRightInset,
		Y: area.Y + area.Height - bubbleSize - bubbleBottomInset,
	}
	if saved != nil {
		position = *saved
	}
	position = clampPoint(position, area)
	return application.Rect{
		X:      position.X,
		Y:      position.Y,
		Width:  bubbleSize,
		Height: bubbleSize,
	}
}

// anchorCorner 决定收起时水滴贴住主窗口的哪个角：参考主窗口
// 中心，窗口往悬浮球那一侧收。展开不使用锚点，悬浮球原地淡出
// 后窗口直接回到记忆位置。
func anchorCorner(centerX, centerY, referenceX, referenceY int) string {
	horizontal := "left"
	if centerX > referenceX {
		horizontal = "right"
	}
	vertical := "top"
	if centerY > referenceY {
		vertical = "bottom"
	}
	return vertical + "-" + horizontal
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
