package backend

import (
	"path/filepath"
	"testing"
)

func TestSetBubbleHiddenPersists(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	app, err := NewAppWithConfig(DefaultConfig(), NewConfigStore(path))
	if err != nil {
		t.Fatal(err)
	}
	if app.GetDesktopConfig().BubbleHidden {
		t.Fatal("new config should start with bubble visible")
	}
	if err := app.SetBubbleHidden(true); err != nil {
		t.Fatal(err)
	}
	if !app.GetDesktopConfig().BubbleHidden {
		t.Fatal("SetBubbleHidden(true) did not persist")
	}
	// 用全新的 store 重读同一份文件，模拟真实启动（NewApp 会 Load）：
	// 复用旧 store 会因 Save 已记录指纹而判定「无变化」，读不到落盘值。
	reloaded, err := NewAppWithConfig(DefaultConfig(), NewConfigStore(path))
	if err != nil {
		t.Fatal(err)
	}
	if !reloaded.GetDesktopConfig().BubbleHidden {
		t.Fatal("bubble hidden state lost after reload")
	}
}

func TestSaveDesktopConfigPreservesBubbleHidden(t *testing.T) {
	app, err := NewAppWithConfig(DefaultConfig(), NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	if err := app.SetBubbleHidden(true); err != nil {
		t.Fatal(err)
	}
	// 设置面板回传的配置不含隐藏态（零值 false），保存不能把它重置。
	panel := app.GetDesktopConfig()
	panel.BubbleHidden = false
	panel.AutoPaste = false
	if err := app.SaveDesktopConfig(panel); err != nil {
		t.Fatal(err)
	}
	if !app.GetDesktopConfig().BubbleHidden {
		t.Fatal("SaveDesktopConfig reset the hidden state owned by SetBubbleHidden")
	}
}

func TestBubbleHiddenDefaultsFalseForLegacyConfig(t *testing.T) {
	// 旧配置 JSON 没有 bubbleHidden 字段，bool 零值天然兼容，
	// configVersion 保持 2，加载后悬浮球默认可见。
	cfg := DefaultConfig()
	cfg.Desktop.BubbleHidden = false
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	if app.Config().Version != configVersion {
		t.Fatalf("config version = %d, want %d (must stay unchanged)", app.Config().Version, configVersion)
	}
	if app.GetDesktopConfig().BubbleHidden {
		t.Fatal("legacy config should backfill bubbleHidden=false")
	}
}
