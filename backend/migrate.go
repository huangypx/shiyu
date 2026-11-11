package backend

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
)

// 改名与搬家都只做一次，判据统一是「新位置没有东西、旧位置有东西」。
// 迁移代码出错不该让用户丢数据，所以旧内容一律保留（rename 搬走的除外，
// 它本身就是原子的移动）。

// MigrateLegacyHome 把改名前的数据目录整体搬到新位置。返回是否真的搬过。
//
// 优先 rename：同一文件系统上它是一次原子操作，配置与历史要么全在新位置、
// 要么全在旧位置，不会出现搬了一半的状态。跨设备时 rename 会失败，
// 退化成逐文件复制，此时旧目录原样留下，用户确认无误后可以自己删。
func MigrateLegacyHome(paths Paths) (bool, error) {
	if paths.Home == "" {
		return false, nil
	}
	legacy := legacyHomeDir()
	if legacy == "" || legacy == paths.Home {
		return false, nil
	}
	// 新目录非空说明已经搬过，或者用户在新版本里自己建过数据；
	// 这时再搬会覆盖掉这些内容。
	entries, err := os.ReadDir(paths.Home)
	switch {
	case err == nil && len(entries) > 0:
		return false, nil
	case err != nil && !errors.Is(err, fs.ErrNotExist):
		return false, fmt.Errorf("check data directory: %w", err)
	}
	info, err := os.Stat(legacy)
	if errors.Is(err, fs.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("check legacy data directory: %w", err)
	}
	if !info.IsDir() {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(paths.Home), 0o700); err != nil {
		return false, fmt.Errorf("prepare data directory parent: %w", err)
	}
	if err := os.Rename(legacy, paths.Home); err == nil {
		return true, nil
	}
	if err := copyDir(legacy, paths.Home); err != nil {
		return false, fmt.Errorf("copy legacy data directory: %w", err)
	}
	return true, nil
}

// copyDir 逐文件复制目录树，供跨设备搬迁兜底。
func copyDir(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		return copyFile(path, target)
	})
}

// copyFile 复制单个文件。权限至少保留属主读写：数据目录里是配置、
// API key 和历史库，复制过程反而放宽权限会留下隐患。
func copyFile(src, dst string) error {
	info, err := os.Stat(src)
	if err != nil {
		return err
	}
	data, err := os.ReadFile(src)
	if err != nil {
		return err
	}
	return os.WriteFile(dst, data, info.Mode().Perm()|0o600)
}

// MigrateLegacyConfig 把旧路径的配置搬到新路径。返回是否真的搬过。
// 它不做校验以外的解释：旧文件损坏时返回错误，由调用方决定是
// 提示用户还是直接忽略。
func MigrateLegacyConfig(paths Paths) (bool, error) {
	if paths.ConfigPath == "" || paths.LegacyConfigPath == "" {
		return false, nil
	}
	if paths.ConfigPath == paths.LegacyConfigPath {
		return false, nil
	}
	// 新位置已经有配置就什么都不做：用户可能已经在应用里改过设置，
	// 此时用旧文件覆盖会丢掉这些改动。
	if _, err := os.Stat(paths.ConfigPath); err == nil {
		return false, nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return false, fmt.Errorf("check config path: %w", err)
	}
	data, err := os.ReadFile(paths.LegacyConfigPath)
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("read legacy config: %w", err)
	}
	// 先解码再落盘：把损坏的旧文件原样复制过去，会让新路径
	// 变成一个启动即失败的文件，比不迁移更糟。
	cfg, err := decodeConfig(data)
	if err != nil {
		return false, fmt.Errorf("decode legacy config: %w", err)
	}
	cfg.applyDefaults()
	if err := NewConfigStore(paths.ConfigPath).Save(cfg); err != nil {
		return false, fmt.Errorf("write migrated config: %w", err)
	}
	return true, nil
}
