package desktop

import _ "embed"

// trayIdleIcon 是 Windows 任务栏的静态中灰图标，trayTemplateIcon 是
// macOS 菜单栏的模板图（黑稿，系统按外观与失焦/高亮自动着色）。两者
// 由 build/icons/tray.svg 经 generate:brand 渲染到 desktop/assets/tray/。
// go:embed 不能跨父目录引用 build/icons，因此位图必须落在本包内。
//
//go:embed assets/tray/idle.png
var trayIdleIcon []byte

//go:embed assets/tray/template.png
var trayTemplateIcon []byte
