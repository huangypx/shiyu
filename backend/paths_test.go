package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveHomePrefersEnvVar(t *testing.T) {
	dir := t.TempDir()
	t.Setenv(HomeEnvVar, dir)
	paths, err := DefaultPaths()
	if err != nil {
		t.Fatal(err)
	}
	if paths.Home != dir {
		t.Fatalf("home = %q, want %q", paths.Home, dir)
	}
	if paths.ConfigPath != filepath.Join(dir, "config.json") {
		t.Fatalf("config path = %q", paths.ConfigPath)
	}
	if paths.HistoryPath != filepath.Join(dir, "history.db") {
		t.Fatalf("history path = %q", paths.HistoryPath)
	}
}

func TestResolveHomeExpandsRelativeEnvVar(t *testing.T) {
	// 环境变量是相对路径时展开成绝对路径，否则切换工作目录
	// 会让同一份配置指向两个位置。
	t.Setenv(HomeEnvVar, "relative-home")
	paths, err := DefaultPaths()
	if err != nil {
		t.Fatal(err)
	}
	if !filepath.IsAbs(paths.Home) {
		t.Fatalf("home = %q, want an absolute path", paths.Home)
	}
}

func TestResolveHomeFallsBackToUserHome(t *testing.T) {
	t.Setenv(HomeEnvVar, "")
	home, err := os.UserHomeDir()
	if err != nil {
		t.Skip("no user home directory in this environment")
	}
	paths, err := DefaultPaths()
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(home, ".shiyu")
	if paths.Home != want {
		t.Fatalf("home = %q, want %q", paths.Home, want)
	}
}

func TestEnsureHomeCreatesPrivateDirectory(t *testing.T) {
	home := filepath.Join(t.TempDir(), "nested", "home")
	paths := PathsFor(home)
	if err := paths.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(home)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o700 {
		t.Fatalf("directory mode = %o, want 700", info.Mode().Perm())
	}
}

func TestTouchFileUsesUserOnlyPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	if err := TouchFile(path); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("file mode = %o, want 600", info.Mode().Perm())
	}
	// 重复调用不能截断已有内容。
	if err := os.WriteFile(path, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := TouchFile(path); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(data)) != "keep" {
		t.Fatalf("file content = %q, want it preserved", data)
	}
}
