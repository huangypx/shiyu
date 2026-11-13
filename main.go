package main

import (
	"embed"
	"log"

	"github.com/huangypx/shiyu/backend"
	"github.com/huangypx/shiyu/desktop"
	"github.com/wailsapp/wails/v3/pkg/application"
)

// frontendDist 由前端工作区的 `npm run build` 生成。把编译好的
// 界面嵌进二进制，发布时就不再依赖外部文件。
//
//go:embed all:frontend/dist
var frontendDist embed.FS

func main() {
	paths, err := backend.DefaultPaths()
	if err != nil {
		log.Fatalf("resolve data directory: %v", err)
	}
	// 改名前的数据目录先整体搬过来，再建目录：EnsureHome 会创建新目录，
	// 先建的话搬迁就失去了「新位置为空」这个唯一判据。
	// 搬迁失败不阻止启动，用户至少还能进设置重新填一遍。
	if moved, err := backend.MigrateLegacyHome(paths); err != nil {
		log.Printf("migrate legacy data directory: %v", err)
	} else if moved {
		log.Printf("migrated data directory to %s", paths.Home)
	}
	// 目录权限在创建时收紧；配置文件由 ConfigStore 自己按 0600 写。
	if err := paths.EnsureHome(); err != nil {
		log.Fatalf("prepare data directory: %v", err)
	}
	// 旧路径的配置只搬一次。迁移失败不该阻止启动：默认配置仍然
	// 可用，用户可以在设置里重填，比整个应用打不开要好。
	if moved, err := backend.MigrateLegacyConfig(paths); err != nil {
		log.Printf("migrate legacy config: %v", err)
	} else if moved {
		log.Printf("migrated config from %s", paths.LegacyConfigPath)
	}
	app, err := backend.NewApp(paths.ConfigPath)
	if err != nil {
		log.Fatalf("initialize application: %v", err)
	}

	// 历史库打不开时应用仍要能用：录音、转写与整理都不依赖它，
	// 只是历史页会提示存储不可用。
	if err := app.AttachHistory(paths.HistoryPath); err != nil {
		log.Printf("open history database: %v", err)
	}

	cfg := app.GetDesktopConfig()
	// 保留期清理只在启动时跑一次：桌面进程寿命短，没有后台
	// 定时任务的必要，也避免长期持有写锁。
	if removed, err := app.PruneHistory(cfg.HistoryRetentionDays); err != nil {
		log.Printf("prune history: %v", err)
	} else if removed > 0 {
		log.Printf("pruned %d history records older than %d days", removed, cfg.HistoryRetentionDays)
	}

	// Wails v3 把应用、窗口和事件循环拆成三步：先创建应用并注册
	// 服务，再创建唯一的窗口，最后交给 Run 启动。控制器需要窗口
	// 指针，因此在窗口创建后单独注册。
	desktopApp := application.New(application.Options{
		Name: "拾语 · Shiyu",
		Services: []application.Service{
			application.NewService(app),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(frontendDist),
		},
		Mac: application.MacOptions{
			// 托盘常驻：关窗或隐藏悬浮球后进程不退出，仍可从菜单栏
			// 图标恢复；退出只走托盘菜单/控制器的 Quit。
			ApplicationShouldTerminateAfterLastWindowClosed: false,
		},
	})

	// 后端只依赖一个 Emitter 回调，事件通道的具体实现留在宿主：
	// backend 包因此不需要 import Wails，测试里也好替换。
	backend.AttachEmitter(app, func(name string, data any) {
		desktopApp.Event.Emit(name, data)
	})

	window := desktopApp.Window.NewWithOptions(desktop.NewWindowOptions(cfg.StartInBubble))
	controller := desktop.NewController(app, desktopApp, window)
	desktopApp.RegisterService(application.NewService(controller))
	desktop.RegisterBubbleMenu(desktopApp, controller)

	if err := desktopApp.Run(); err != nil {
		log.Fatalf("start application: %v", err)
	}
}
