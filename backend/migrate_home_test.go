package backend

import (
	"os"
	"path/filepath"
	"testing"
)

// withTempHome 把家目录指到临时目录，避免迁移用例碰到真实的
// ~/.open-typeless。单独包一层是因为每个用例都要做同样两件事。
func withTempHome(t *testing.T) string {
	t.Helper()
	home := t.TempDir()
	t.Setenv("HOME", home)
	return home
}

func TestMigrateLegacyHomeRenamesDirectory(t *testing.T) {
	home := withTempHome(t)
	legacy := filepath.Join(home, legacyHomeDirName)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := PathsFor(filepath.Join(home, homeDirName))
	moved, err := MigrateLegacyHome(paths)
	if err != nil || !moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
	// 同设备上走 rename，旧目录不再存在，数据也只能出现在新位置。
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy directory should be gone after rename: %v", err)
	}
	data, err := os.ReadFile(filepath.Join(paths.Home, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "{}" {
		t.Fatalf("config = %q", data)
	}
}

func TestMigrateLegacyHomeSkipsWhenNewDirectoryHasData(t *testing.T) {
	home := withTempHome(t)
	legacy := filepath.Join(home, legacyHomeDirName)
	if err := os.MkdirAll(legacy, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(legacy, "config.json"), []byte("old"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := PathsFor(filepath.Join(home, homeDirName))
	if err := paths.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	// 新目录里已经有配置：此时搬迁会覆盖用户在新版本里的改动。
	if err := os.WriteFile(filepath.Join(paths.Home, "config.json"), []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	moved, err := MigrateLegacyHome(paths)
	if err != nil || moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
	data, err := os.ReadFile(filepath.Join(paths.Home, "config.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "new" {
		t.Fatalf("config = %q, want the new one kept", data)
	}
}

func TestMigrateLegacyHomeWithoutLegacyDirectory(t *testing.T) {
	home := withTempHome(t)
	paths := PathsFor(filepath.Join(home, homeDirName))
	moved, err := MigrateLegacyHome(paths)
	if err != nil || moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
}

func TestMigrateLegacyHomeCopiesWhenRenameFails(t *testing.T) {
	home := withTempHome(t)
	legacy := filepath.Join(home, legacyHomeDirName)
	nested := filepath.Join(legacy, "nested")
	if err := os.MkdirAll(nested, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(nested, "history.db"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := PathsFor(filepath.Join(home, homeDirName))
	// 新路径的父目录是一个普通文件，rename 与 MkdirAll 都会失败，
	// 用来确认失败时不会悄悄返回成功。
	blocked := filepath.Join(home, "blocked")
	if err := os.WriteFile(blocked, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths.Home = filepath.Join(blocked, "data")
	if moved, err := MigrateLegacyHome(paths); err == nil || moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
}
