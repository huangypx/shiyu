package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestMigrateLegacyConfigMovesFile(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	legacy := filepath.Join(root, "legacy", "config.json")
	if err := os.MkdirAll(filepath.Dir(legacy), 0o700); err != nil {
		t.Fatal(err)
	}
	// 旧文件是单模型格式，迁移时顺带升级到 v2。
	body := `{"asr":{"provider":"custom","baseUrl":"https://asr.test/v1","model":"m1"},"llm":{"provider":"custom","baseUrl":"https://llm.test/v1","model":"m2"},"desktop":{"hotkey":"Alt+Space"}}`
	if err := os.WriteFile(legacy, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := Paths{Home: home, ConfigPath: filepath.Join(home, "config.json"), LegacyConfigPath: legacy}
	if err := paths.EnsureHome(); err != nil {
		t.Fatal(err)
	}

	moved, err := MigrateLegacyConfig(paths)
	if err != nil || !moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
	cfg, err := NewConfigStore(paths.ConfigPath).Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Version != configVersion || cfg.ASR.Models[0].Model != "m1" {
		t.Fatalf("migrated config = %+v", cfg)
	}
	if cfg.Desktop.Hotkey != "Alt+Space" {
		t.Fatalf("hotkey = %q", cfg.Desktop.Hotkey)
	}
	// 旧文件保留，迁移出错时用户还能拿回来。
	if _, err := os.Stat(legacy); err != nil {
		t.Fatalf("legacy config should be kept: %v", err)
	}
}

func TestMigrateLegacyConfigIsIdempotentAndNeverOverwrites(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	legacy := filepath.Join(root, "legacy.json")
	if err := os.WriteFile(legacy, []byte(`{"asr":{"provider":"custom","baseUrl":"https://old.test/v1","model":"old"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := Paths{Home: home, ConfigPath: filepath.Join(home, "config.json"), LegacyConfigPath: legacy}
	if err := paths.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	if moved, err := MigrateLegacyConfig(paths); err != nil || !moved {
		t.Fatalf("first migration moved=%v err=%v", moved, err)
	}
	// 再跑一次不再动作：新文件已存在，绝不能拿旧文件盖掉它。
	if moved, err := MigrateLegacyConfig(paths); err != nil || moved {
		t.Fatalf("second migration moved=%v err=%v", moved, err)
	}
}

func TestMigrateLegacyConfigIgnoresBrokenFile(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	legacy := filepath.Join(root, "legacy.json")
	if err := os.WriteFile(legacy, []byte("{ broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	paths := Paths{Home: home, ConfigPath: filepath.Join(home, "config.json"), LegacyConfigPath: legacy}
	if err := paths.EnsureHome(); err != nil {
		t.Fatal(err)
	}
	// 损坏的旧文件不能变成「启动即失败」的新文件。
	if moved, err := MigrateLegacyConfig(paths); err == nil || moved {
		t.Fatalf("broken legacy moved=%v err=%v", moved, err)
	}
	if _, err := os.Stat(paths.ConfigPath); !os.IsNotExist(err) {
		t.Fatal("a broken legacy file should not produce a new config")
	}
}

func TestMigrateLegacyConfigWithoutLegacyFile(t *testing.T) {
	root := t.TempDir()
	paths := Paths{Home: root, ConfigPath: filepath.Join(root, "config.json"), LegacyConfigPath: filepath.Join(root, "missing.json")}
	moved, err := MigrateLegacyConfig(paths)
	if err != nil || moved {
		t.Fatalf("moved=%v err=%v", moved, err)
	}
}
