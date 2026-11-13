package desktop

import (
	"errors"
	"os"
	"path/filepath"
	"slices"
	"strings"

	"github.com/huangypx/shiyu/backend"
)

// BackgroundStartup 让登录启动单独进入后台，保留用户手动打开窗口时的偏好。
func BackgroundStartup(startInBubble bool, args []string) bool {
	return startInBubble || slices.Contains(args, "--background")
}

// SaveDesktopConfig 在保存开机启动偏好时同步系统设置，落盘失败则恢复原设置。
func (c *Controller) SaveDesktopConfig(cfg backend.DesktopConfig) error {
	if c.app == nil {
		return errors.New("backend app is not configured")
	}
	c.startupMu.Lock()
	defer c.startupMu.Unlock()
	previous := c.app.GetDesktopConfig()
	changed := previous.LaunchAtLogin != cfg.LaunchAtLogin
	if changed {
		if err := setLaunchAtLogin(cfg.LaunchAtLogin); err != nil {
			return err
		}
	}
	if err := c.app.SaveDesktopConfig(cfg); err != nil {
		if changed {
			return errors.Join(err, setLaunchAtLogin(previous.LaunchAtLogin))
		}
		return err
	}
	return nil
}

func startupExecutable() (string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	for directory := filepath.Dir(executable); ; directory = filepath.Dir(directory) {
		if strings.HasPrefix(filepath.Base(directory), "go-build") {
			// go run 的临时程序会被删除，登录项必须指向项目构建的稳定程序。
			built, err := filepath.Abs(filepath.Join("bin", "shiyu.exe"))
			if err != nil {
				return "", err
			}
			info, err := os.Stat(built)
			if err != nil || !info.Mode().IsRegular() {
				return "", errors.New("build bin/shiyu.exe before enabling launch at login")
			}
			return built, nil
		}
		if directory == filepath.Dir(directory) {
			return executable, nil
		}
	}
}
