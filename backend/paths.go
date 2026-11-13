package backend

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// HomeEnvVar 让测试、便携模式和 dotfiles 用户改写数据目录。
// 优先级高于家目录，这样同一台机器上可以并存多套配置。
const HomeEnvVar = "SHIYU_HOME"

// homeDirName 是家目录下的数据目录名。以点开头意味着
// Finder 默认隐藏它，因此界面需要能展示真实路径。
const homeDirName = ".shiyu"

// legacyHomeDirName 是改名前的数据目录名。它只服务于一次性搬迁：
// 老用户的配置与历史都放在这里，换个名字启动就会看到空配置。
// 除迁移代码外不要再引用它。
const legacyHomeDirName = ".open-typeless"

// legacyConfigDirName 是更早版本在 os.UserConfigDir() 下的目录名。
// 它没有前导点，与家目录里的旧目录不是同一个名字，不能并成一个常量。
const legacyConfigDirName = "open-typeless"

// Paths 汇总所有需要持久化的绝对路径。集中在一处，
// 调用方就不必各自拼路径，迁移也能一次算清楚旧位置。
type Paths struct {
	Home             string
	ConfigPath       string
	HistoryPath      string
	WebviewPath      string
	LegacyConfigPath string
	LegacyNotesPath  string
}

// DefaultPaths 解析数据目录。环境变量与家目录都不可用时
// 直接报错：回退到当前工作目录会让数据散落在启动目录里，
// 比明确失败更难排查。
func DefaultPaths() (Paths, error) {
	home, err := resolveHome()
	if err != nil {
		return Paths{}, err
	}
	return PathsFor(home), nil
}

func resolveHome() (string, error) {
	if custom := strings.TrimSpace(os.Getenv(HomeEnvVar)); custom != "" {
		// 环境变量可能是相对路径，展开成绝对路径，
		// 否则切换工作目录后同一份配置会指向两个位置。
		abs, err := filepath.Abs(custom)
		if err != nil {
			return "", fmt.Errorf("resolve %s: %w", HomeEnvVar, err)
		}
		return abs, nil
	}
	dir, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("resolve user home directory: %w", err)
	}
	return filepath.Join(dir, homeDirName), nil
}

// PathsFor 按给定数据目录推导出全部路径。测试用它指向
// 临时目录，不必改动真实家目录。
func PathsFor(home string) Paths {
	return Paths{
		Home:             home,
		ConfigPath:       filepath.Join(home, "config.json"),
		HistoryPath:      filepath.Join(home, "history.db"),
		WebviewPath:      filepath.Join(home, "webview"),
		LegacyConfigPath: legacyConfigPath(),
	}
}

// legacyConfigPath 是改用家目录之前的配置位置。它只用于
// 一次性迁移，旧文件本身保留不删。
func legacyConfigPath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, legacyConfigDirName, "config.json")
}

// legacyHomeDir 返回改名前的家目录数据目录。家目录不可用时返回
// 空串，由调用方当作「没有旧数据」处理。
func legacyHomeDir() string {
	dir, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(dir, legacyHomeDirName)
}

// EnsureHome 创建数据目录并收紧权限。目录已存在时只补齐
// 缺失的权限位，不改动其他属性。
func (p Paths) EnsureHome() error {
	if strings.TrimSpace(p.Home) == "" {
		return fmt.Errorf("data directory is empty")
	}
	if err := os.MkdirAll(p.Home, 0o700); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}
	return nil
}

// TouchFile 以 0600 预创建文件。SQLite 驱动会按 umask 建库，
// 常见 umask 下会得到 0644；预先建好文件再交给驱动打开，
// 权限就由我们决定。
func TouchFile(path string) error {
	if strings.TrimSpace(path) == "" {
		return fmt.Errorf("file path is empty")
	}
	file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create file %s: %w", path, err)
	}
	if err := file.Close(); err != nil {
		return fmt.Errorf("close file %s: %w", path, err)
	}
	return nil
}
