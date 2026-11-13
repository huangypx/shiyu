package backend

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func assertStorageMode(t *testing.T, path string, want os.FileMode) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	mask := os.ModeType | os.ModePerm
	if runtime.GOOS == "windows" {
		// Windows 由 ACL 控制访问。Go 的写权限位只反映文件的只读属性。
		mask = os.ModeType | 0o200
	}
	if got := info.Mode() & mask; got != want&mask {
		t.Fatalf("%s: mode = %v, want %v (mask %v)", path, got, want&mask, mask)
	}
}

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
	if paths.WebviewPath != filepath.Join(dir, "webview") {
		t.Fatalf("WebView data path = %q", paths.WebviewPath)
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
	assertStorageMode(t, home, os.ModeDir|0o700)
}

func TestTouchFileUsesUserOnlyPermissions(t *testing.T) {
	path := filepath.Join(t.TempDir(), "history.db")
	if err := TouchFile(path); err != nil {
		t.Fatal(err)
	}
	assertStorageMode(t, path, 0o600)
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
