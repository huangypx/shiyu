package backend

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func newTestConfig(t *testing.T) (Config, *ConfigStore) {
	t.Helper()
	dir := t.TempDir()
	return DefaultConfig(), NewConfigStore(filepath.Join(dir, "nested", "config.json"))
}

func TestConfigStoreRoundTripAndDefaults(t *testing.T) {
	cfg, store := newTestConfig(t)
	got, err := store.Load()
	if err != nil {
		t.Fatalf("load missing config: %v", err)
	}
	if got.Version != configVersion || got.LLM.SystemPrompt == "" || got.Desktop.Hotkey == "" {
		t.Fatalf("missing defaults: %+v", got)
	}
	if len(got.ASR.Models) != 1 || len(got.LLM.Models) != 1 {
		t.Fatalf("expected a single default model per kind, got %+v", got)
	}
	got.ASR.Models[0].APIKey = "secret"
	if err := store.Save(got); err != nil {
		t.Fatalf("save: %v", err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatalf("load saved config: %v", err)
	}
	if loaded.ASR.Models[0].APIKey != "secret" {
		t.Fatalf("secret did not round trip")
	}
	info, err := os.Stat(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("config mode = %o, want 600", info.Mode().Perm())
	}
	_ = cfg
}

func TestASRStreamFlagRoundTrip(t *testing.T) {
	cfg, store := newTestConfig(t)
	cfg.ASR.Models[0].Stream = true
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	loaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if !loaded.ASR.Models[0].Stream {
		t.Fatal("stream flag was not persisted")
	}

	// 没打开的模型不该在文件里留下这个键，旧版本读到的配置
	// 因此与升级前完全一致。
	loaded.ASR.Models[0].Stream = false
	if err := store.Save(loaded); err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "\"stream\"") {
		t.Fatalf("disabled stream flag should be omitted: %s", raw)
	}
}

func TestConfigStoreMigratesLegacySingleModel(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	// 旧版本没有 version，asr/llm 直接是单个端点的字段。
	legacy := []byte(`{
  "asr": {"provider": "custom", "baseUrl": "https://asr.test/v1", "model": "m1", "language": "zh"},
  "llm": {"provider": "custom", "baseUrl": "https://llm.test/v1", "model": "m2", "temperature": 0.5, "systemPrompt": "keep my words"},
  "desktop": {"hotkey": "Alt+Space", "resultHistoryLimit": 50}
}`)
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	cfg, err := NewConfigStore(path).Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Version != configVersion {
		t.Fatalf("version = %d, want %d", cfg.Version, configVersion)
	}
	if len(cfg.ASR.Models) != 1 || cfg.ASR.Models[0].Model != "m1" || cfg.ASR.ActiveID != defaultModelID {
		t.Fatalf("asr models = %+v", cfg.ASR)
	}
	if cfg.ASR.Language != "zh" {
		t.Fatalf("asr language = %q, want it lifted to the section", cfg.ASR.Language)
	}
	if len(cfg.LLM.Models) != 1 || cfg.LLM.Models[0].Temperature != 0.5 {
		t.Fatalf("llm models = %+v", cfg.LLM.Models)
	}
	// 旧 systemPrompt 迁移成「我的整理」预设，不能丢。
	if len(cfg.LLM.Presets) != 1 || cfg.LLM.Presets[0].SystemPrompt != "keep my words" || cfg.LLM.Presets[0].Name != "我的整理" {
		t.Fatalf("migrated presets = %+v", cfg.LLM.Presets)
	}
	if cfg.LLM.ActivePresetID != "custom" {
		t.Fatalf("active preset = %q, want custom", cfg.LLM.ActivePresetID)
	}
	if cfg.Desktop.Hotkey != "Alt+Space" {
		t.Fatalf("hotkey = %q", cfg.Desktop.Hotkey)
	}
	// 旧版的条数限制不再沿用，保留期默认永久。
	if cfg.Desktop.HistoryRetentionDays != 0 {
		t.Fatalf("retention = %d, want 0", cfg.Desktop.HistoryRetentionDays)
	}
}

func TestConfigStoreRejectsNewerVersion(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"version": 99}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewConfigStore(path).Load(); err == nil {
		t.Fatal("expected a newer config version to be rejected")
	}
}

func TestConfigStoreReloadsAfterExternalEdit(t *testing.T) {
	cfg, store := newTestConfig(t)
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	if _, changed, err := store.LoadIfChanged(); err != nil || changed {
		t.Fatalf("unchanged file: changed=%v err=%v", changed, err)
	}

	edited := cfg
	edited.LLM.Models[0].Model = "gpt-cheap"
	// 直接写文件，模拟用户在应用运行时手工编辑。
	if err := store.Save(edited); err != nil {
		t.Fatal(err)
	}
	// Save 自己会刷新指纹，因此再改一次内容但不经过 Save。
	data, err := os.ReadFile(store.Path())
	if err != nil {
		t.Fatal(err)
	}
	manual := string(data)
	manual = replaceOnce(manual, `"model": "gpt-cheap"`, `"model": "gpt-pricey"`)
	if err := os.WriteFile(store.Path(), []byte(manual), 0o600); err != nil {
		t.Fatal(err)
	}
	// 文件系统时间戳精度有限，显式推进一次避免同秒写入被判定为未变化。
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(store.Path(), future, future); err != nil {
		t.Fatal(err)
	}

	reloaded, changed, err := store.LoadIfChanged()
	if err != nil || !changed {
		t.Fatalf("changed=%v err=%v", changed, err)
	}
	if reloaded.LLM.Models[0].Model != "gpt-pricey" {
		t.Fatalf("model = %q, want the manually edited value", reloaded.LLM.Models[0].Model)
	}
}

func TestConfigStoreKeepsMemoryConfigOnBrokenFile(t *testing.T) {
	cfg, store := newTestConfig(t)
	if err := store.Save(cfg); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(store.Path(), []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, _, err := store.LoadIfChanged(); err == nil {
		t.Fatal("expected a decode error for a broken file")
	}
	if store.Warning() == "" {
		t.Fatal("broken file should leave a warning behind")
	}
}

func TestResolveSecret(t *testing.T) {
	if got, err := ResolveSecret("  sk-plain  "); err != nil || got != "sk-plain" {
		t.Fatalf("plain secret = %q err=%v", got, err)
	}
	t.Setenv("OT_TEST_KEY", "sk-env")
	if got, err := ResolveSecret("env:OT_TEST_KEY"); err != nil || got != "sk-env" {
		t.Fatalf("env secret = %q err=%v", got, err)
	}
	if _, err := ResolveSecret("env:OT_TEST_MISSING"); err == nil {
		t.Fatal("missing environment variable should fail")
	}

	path := filepath.Join(t.TempDir(), "key.txt")
	if err := os.WriteFile(path, []byte("  sk-file\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if got, err := ResolveSecret("file:" + path); err != nil || got != "sk-file" {
		t.Fatalf("file secret = %q err=%v", got, err)
	}
	if _, err := ResolveSecret("file:" + filepath.Join(t.TempDir(), "missing")); err == nil {
		t.Fatal("missing key file should fail")
	}
}

func TestConfigValidationForModels(t *testing.T) {
	cfg := DefaultConfig()
	if err := cfg.Validate(); err != nil {
		t.Fatalf("default config should validate: %v", err)
	}

	duplicated := DefaultConfig()
	duplicated.ASR.Models = append(duplicated.ASR.Models, duplicated.ASR.Models[0])
	if err := duplicated.Validate(); err == nil {
		t.Fatal("duplicated model ids should be rejected")
	}

	badURL := DefaultConfig()
	badURL.LLM.Models[0].BaseURL = "not-a-url"
	if err := badURL.Validate(); err == nil {
		t.Fatal("invalid base URL should be rejected")
	}

	badPreset := DefaultConfig()
	badPreset.LLM.Presets[0].ModelID = "missing-model"
	if err := badPreset.Validate(); err == nil {
		t.Fatal("preset referencing an unknown model should be rejected")
	}

	// 温度越界。
	hot := DefaultConfig()
	hot.LLM.Models[0].Temperature = 3
	if err := hot.Validate(); err == nil {
		t.Fatal("expected temperature validation error")
	}
}

func TestApplyDefaultsRepairsModelsAndPresets(t *testing.T) {
	cfg := DefaultConfig()
	cfg.ASR.Models = []ASRConfig{
		{ID: "", Name: " 第一个 ", Model: "m1"},
		{ID: "default", Name: "重名", Model: "m2"},
		{ID: "default", Name: "重复", Model: "m3"},
	}
	cfg.ASR.ActiveID = "missing"
	cfg.LLM.Presets = []PolishPreset{
		{ID: "", Name: " 第一个 ", SystemPrompt: " prompt a ", ModelID: "gone"},
		{ID: "default", Name: "重名 ID", SystemPrompt: "prompt b"},
	}
	cfg.LLM.ActivePresetID = "missing"
	cfg.LLM.Models[0].ID = defaultModelID
	cfg.applyDefaults()

	if cfg.ASR.Models[0].ID != "model-1" || cfg.ASR.Models[0].Name != "第一个" || cfg.ASR.Models[0].Model != "m1" {
		t.Fatalf("first asr model = %+v", cfg.ASR.Models[0])
	}
	if cfg.ASR.Models[2].ID == "default" {
		t.Fatalf("duplicate asr id was not repaired: %+v", cfg.ASR.Models)
	}
	// 生效 ID 失效时回落到第一个模型。
	if cfg.ASR.ActiveID != cfg.ASR.Models[0].ID {
		t.Fatalf("active asr = %q, want the first model", cfg.ASR.ActiveID)
	}
	// 绑定了已删除模型的预设回到「跟随全局」。
	if cfg.LLM.Presets[0].ModelID != "" {
		t.Fatalf("stale preset binding = %q, want it cleared", cfg.LLM.Presets[0].ModelID)
	}
	if cfg.LLM.ActivePresetID != "" {
		t.Fatalf("stale active preset = %q, want it cleared", cfg.LLM.ActivePresetID)
	}
	if preset, ok := cfg.ResolvePolishPreset(""); !ok || preset.ID != "preset-1" {
		t.Fatalf("resolved preset = %+v, ok = %v", preset, ok)
	}
	if err := cfg.Validate(); err != nil {
		t.Fatalf("repaired config should validate: %v", err)
	}
}

func TestResolveLLMModelPrefersPresetBinding(t *testing.T) {
	cfg := DefaultConfig()
	cfg.LLM.Models = append(cfg.LLM.Models, LLMConfig{ID: "cheap", Name: "便宜模型", Provider: "openai-compatible", BaseURL: "https://cheap.test/v1", Model: "m-cheap"})
	cfg.LLM.ActiveID = defaultModelID

	preset, _ := cfg.ResolvePolishPreset(defaultActivePresetID)
	model, ok := cfg.ResolveLLMModel(preset)
	if !ok || model.ID != defaultModelID {
		t.Fatalf("unbound preset should follow the active model, got %+v", model)
	}

	bound := preset
	bound.ModelID = "cheap"
	model, ok = cfg.ResolveLLMModel(bound)
	if !ok || model.ID != "cheap" {
		t.Fatalf("bound preset should pick the cheap model, got %+v", model)
	}
}

func replaceOnce(text, old, replacement string) string {
	index := indexOf(text, old)
	if index < 0 {
		return text
	}
	return text[:index] + replacement + text[index+len(old):]
}

func indexOf(text, substring string) int {
	for i := 0; i+len(substring) <= len(text); i++ {
		if text[i:i+len(substring)] == substring {
			return i
		}
	}
	return -1
}
