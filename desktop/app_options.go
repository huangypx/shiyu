package desktop

import (
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NewWindowOptions 为 Wails v3 构造主窗口选项。窗口在整个生命周期里
// 会在主窗口与浮动球之间切换，所以这里只决定
// 初始形态；切换时的尺寸、置顶和原生 chrome 由 Controller 处理。
//
// macOS 必须使用透明 webview，否则球窗会带一块不透明底色。
// Wails v3 把这条路径放在私有 API 后面：构建时必须加
// -tags private_mac_apis（见 README 和 docs/desktop-interaction.md）。
// 主窗口本身仍由前端 AppShell 绘制不透明画布。
func NewWindowOptions(startInBubble bool) application.WebviewWindowOptions {
	width, height := mainWidth, mainHeight
	minWidth, minHeight := mainMinWidth, mainMinHeight
	if startInBubble {
		// 在隐藏窗口上初始化 WKWebView 会得到空白内容。
		// 先以小尺寸加载，运行时就绪后再按录音状态决定是否显示。
		width, height = bubbleSize, bubbleSize
		minWidth, minHeight = bubbleSize, bubbleSize
	}

	opts := application.WebviewWindowOptions{
		Name: "main",
		// 标题只影响窗口管理器和 Dock 菜单；前台内容由 React 绘制。
		Title:            "拾语 · Shiyu",
		Width:            width,
		Height:           height,
		MinWidth:         minWidth,
		MinHeight:        minHeight,
		Hidden:           startInBubble && runtime.GOOS == "windows",
		Frameless:        runtime.GOOS != "darwin",
		BackgroundType:   application.BackgroundTypeTransparent,
		BackgroundColour: application.NewRGBA(0, 0, 0, 0),
		URL:              "/",
		Windows:          application.WindowsWindow{HiddenOnTaskbar: true},
	}
	if runtime.GOOS == "darwin" {
		opts.Mac = application.MacWindow{
			// 保留真实交通灯，但隐藏标题栏并让内容铺满整个窗口，
			// 与 v2 的 mac.TitleBarHidden() 行为一致。
			TitleBar: application.MacTitleBarHidden,
			// 球窗需要整窗透明；主窗口的底色由 AppShell 的 CSS 画布提供。
			Backdrop: application.MacBackdropTransparent,
		}
	}
	return opts
}
