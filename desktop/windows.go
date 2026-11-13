package desktop

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const (
	ModeMain    = "main"
	ModeBubble  = "bubble"
	ModeOverlay = "overlay"
	// ModeHidden 表示只剩托盘、当前没有任何可见窗口。
	ModeHidden = "hidden"

	mainWidth     = 1000
	mainHeight    = 820
	mainMinWidth  = 640
	mainMinHeight = 640
	// 浮动窗顶部 92x92 是球，底部 34px 预留给悬停工具栏。
	bubbleWidth  = 92
	bubbleHeight = 126

	// agent 首次出现时停在当前屏幕工作区右下角，与边缘留一点
	// 呼吸空间。
	bubbleRightInset  = 28
	bubbleBottomInset = 56

	// overlayWidth/Height 是底部胶囊的原生窗口尺寸。窗口比胶囊
	// （320×56）大一圈，四周留白给 CSS box-shadow。
	overlayWidth  = 360
	overlayHeight = 72
	// overlayBottomInset 让胶囊悬在 Dock/任务栏上方。
	overlayBottomInset = 48

	// Windows 的 WS_EX_NOACTIVATE：显示或点击都不得激活宿主应用，
	// 自动粘贴目标必须仍是按下快捷键时那个前台应用。
	windowsExNoActivate = 0x08000000
)

type point struct {
	X int
	Y int
}

// mainWindowOptions 构造主窗口。主窗口是完整编辑器，macOS 保留
// 原生交通灯，其他平台继续用自绘标题带。
func (c *Controller) mainWindowOptions(rect application.Rect) application.WebviewWindowOptions {
	opts := application.WebviewWindowOptions{
		Name:             ModeMain,
		Title:            "拾语 · Shiyu",
		Width:            rect.Width,
		Height:           rect.Height,
		MinWidth:         mainMinWidth,
		MinHeight:        mainMinHeight,
		Frameless:        runtime.GOOS != "darwin",
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/",
		InitialPosition:  application.WindowXY,
		X:                rect.X,
		Y:                rect.Y,
	}
	if runtime.GOOS == "darwin" {
		opts.Mac = application.MacWindow{
			TitleBar: application.MacTitleBarHidden,
			Backdrop: application.MacBackdropTransparent,
		}
	}
	return opts
}

// bubbleWindowOptions 构造独立悬浮球窗口。它只是视图，录音由
// 底部胶囊负责；窗口本身固定尺寸、透明、无边框。
func (c *Controller) bubbleWindowOptions(rect application.Rect) application.WebviewWindowOptions {
	opts := application.WebviewWindowOptions{
		Name:             ModeBubble,
		Title:            "拾语",
		Width:            bubbleWidth,
		Height:           bubbleHeight,
		MinWidth:         bubbleWidth,
		MinHeight:        bubbleHeight,
		MaxWidth:         bubbleWidth,
		MaxHeight:        bubbleHeight,
		DisableResize:    true,
		Frameless:        true,
		AlwaysOnTop:      c.keepBubbleOnTop(),
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/?view=bubble",
		InitialPosition:  application.WindowXY,
		X:                rect.X,
		Y:                rect.Y,
		Windows: application.WindowsWindow{
			HiddenOnTaskbar:                   true,
			DisableFramelessWindowDecorations: true,
		},
	}
	if runtime.GOOS == "darwin" {
		opts.Mac = application.MacWindow{
			TitleBar:           application.MacTitleBarHidden,
			Backdrop:           application.MacBackdropTransparent,
			DisableShadow:      true,
			CornerType:         application.MacWindowCornerTypeSquare,
			WindowLevel:        application.MacWindowLevelFloating,
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
		}
	}
	return opts
}

// overlayWindowOptions 构造底部胶囊。它只是 Go 会话的视图；
// macOS 用非激活 NSPanel，显示时不会抢焦点。
func (c *Controller) overlayWindowOptions(rect application.Rect) application.WebviewWindowOptions {
	opts := application.WebviewWindowOptions{
		Name:             ModeOverlay,
		Title:            "拾语",
		Width:            overlayWidth,
		Height:           overlayHeight,
		MinWidth:         overlayWidth,
		MinHeight:        overlayHeight,
		MaxWidth:         overlayWidth,
		MaxHeight:        overlayHeight,
		DisableResize:    true,
		Frameless:        true,
		AlwaysOnTop:      true,
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/?view=overlay",
		InitialPosition:  application.WindowXY,
		X:                rect.X,
		Y:                rect.Y,
		Windows: application.WindowsWindow{
			HiddenOnTaskbar:                   true,
			DisableFramelessWindowDecorations: true,
			ExStyle:                           windowsExNoActivate,
		},
	}
	if runtime.GOOS == "darwin" {
		opts.Mac = application.MacWindow{
			TitleBar:           application.MacTitleBarHidden,
			Backdrop:           application.MacBackdropTransparent,
			DisableShadow:      true,
			CornerType:         application.MacWindowCornerTypeSquare,
			WindowLevel:        application.MacWindowLevelFloating,
			CollectionBehavior: application.MacWindowCollectionBehaviorCanJoinAllSpaces | application.MacWindowCollectionBehaviorFullScreenAuxiliary,
			WindowClass:        application.MacWindowClassPanel,
			PanelPreferences: application.MacPanelPreferences{
				NonActivating:          true,
				FloatingPanel:          true,
				BecomesKeyOnlyIfNeeded: true,
			},
		}
	}
	return opts
}

// bubbleTargetBounds 计算悬浮球目标矩形。保存位置仍落在某块屏幕上
// 时沿用那块屏幕和坐标，否则回到工作区右下角。
func bubbleTargetBounds(area application.Rect, saved *point) application.Rect {
	position := point{
		X: area.X + area.Width - bubbleWidth - bubbleRightInset,
		Y: area.Y + area.Height - bubbleHeight - bubbleBottomInset,
	}
	if saved != nil {
		position = *saved
	}
	position = clampPoint(position, area)
	return application.Rect{
		X:      position.X,
		Y:      position.Y,
		Width:  bubbleWidth,
		Height: bubbleHeight,
	}
}

// overlayTargetBounds 把胶囊放到屏幕工作区底部居中，再钳制回工作区。
func overlayTargetBounds(area application.Rect) application.Rect {
	rect := application.Rect{
		X:      area.X + (area.Width-overlayWidth)/2,
		Y:      area.Y + area.Height - overlayHeight - overlayBottomInset,
		Width:  overlayWidth,
		Height: overlayHeight,
	}
	return clampRectToWorkArea(rect, area)
}

func centeredRect(area application.Rect, width, height int) application.Rect {
	return application.Rect{
		X:      area.X + (area.Width-width)/2,
		Y:      area.Y + (area.Height-height)/2,
		Width:  width,
		Height: height,
	}
}

// clampRectToWorkArea 保证恢复的窗口不会因为换屏或分辨率变化被放到
// 工作区外。工作区比窗口小时优先服从工作区。
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

func rectContains(area application.Rect, position point) bool {
	return position.X >= area.X &&
		position.Y >= area.Y &&
		position.X < area.X+area.Width &&
		position.Y < area.Y+area.Height
}

func clampPoint(position point, area application.Rect) point {
	return point{
		X: clampInt(position.X, area.X, area.X+area.Width-bubbleWidth),
		Y: clampInt(position.Y, area.Y, area.Y+area.Height-bubbleHeight),
	}
}

func clampInt(value, low, high int) int {
	if high < low {
		return low
	}
	if value < low {
		return low
	}
	if value > high {
		return high
	}
	return value
}
