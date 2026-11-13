package desktop

import (
	"errors"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows/registry"
)

func TestLaunchAtLoginCanBeEnabledAndDisabled(t *testing.T) {
	// 在独立注册表项里验证开关，测试不会改变真实登录项。
	keyPath := `Software\ShiyuTests\` + filepath.Base(t.TempDir())
	key, _, err := registry.CreateKey(registry.CURRENT_USER, keyPath, registry.ALL_ACCESS)
	if err != nil {
		t.Fatal(err)
	}
	defer registry.DeleteKey(registry.CURRENT_USER, keyPath)
	defer key.Close()
	if err := key.SetStringValue("OtherApp", "keep"); err != nil {
		t.Fatal(err)
	}
	executable := `C:\拾语 Work\shiyu.exe`
	if err := writeLaunchAtLogin(keyPath, executable, true); err != nil {
		t.Fatal(err)
	}
	command, _, err := key.GetStringValue(startupRegistryName)
	if err != nil || command != `"C:\拾语 Work\shiyu.exe" --background` {
		t.Fatalf("startup command = %q, err = %v", command, err)
	}
	for range 2 {
		if err := writeLaunchAtLogin(keyPath, "", false); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, err := key.GetStringValue(startupRegistryName); !errors.Is(err, registry.ErrNotExist) {
		t.Fatalf("startup value still exists: %v", err)
	}
	if value, _, err := key.GetStringValue("OtherApp"); err != nil || value != "keep" {
		t.Fatalf("other startup setting changed: %q, %v", value, err)
	}
}
