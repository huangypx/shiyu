package backend

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

// 测试里反复出现的两件事：把模型指向 httptest 服务器，
// 以及读取「当前生效」的那个模型。
func pointASRAt(cfg *Config, baseURL, model string) {
	cfg.ASR.Models[0].BaseURL = baseURL
	cfg.ASR.Models[0].Model = model
	cfg.ASR.ActiveID = cfg.ASR.Models[0].ID
}

func pointLLMAt(cfg *Config, baseURL, model string) {
	cfg.LLM.Models[0].BaseURL = baseURL
	cfg.LLM.Models[0].Model = model
	cfg.LLM.ActiveID = cfg.LLM.Models[0].ID
}

func TestAppProcessAndRecording(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/transcriptions":
			_ = json.NewEncoder(w).Encode(map[string]string{"text": "raw words"})
		case "/v1/chat/completions":
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "polished words"}}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	cfg := DefaultConfig()
	pointASRAt(&cfg, server.URL+"/v1", "asr")
	pointLLMAt(&cfg, server.URL+"/v1", "llm")
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	data := base64.StdEncoding.EncodeToString([]byte("audio"))
	result, err := app.ProcessAudio(AudioRequest{Data: data, Filename: "x.webm"}, true)
	if err != nil {
		t.Fatalf("process: %v", err)
	}
	if result.Transcript != "raw words" || result.PolishedText != "polished words" || result.ID == "" {
		t.Fatalf("unexpected process result: %+v", result)
	}
	if len(result.Calls) != 2 || result.Calls[0].Kind != CallKindASR || result.Calls[1].Kind != CallKindLLM {
		t.Fatalf("calls = %+v", result.Calls)
	}
	if result.DurationMS < 0 {
		t.Fatalf("duration = %d", result.DurationMS)
	}
	if _, err := app.StartRecording("x.webm", "audio/webm", "", ""); err != nil {
		t.Fatal(err)
	}
	if _, err := app.AppendRecordingChunk(AudioChunk{Data: data}); err != nil {
		t.Fatal(err)
	}
	result, err = app.StopRecording(false)
	if err != nil || result.Transcript != "raw words" || result.PolishedText != "raw words" {
		t.Fatalf("stop = %+v, err = %v", result, err)
	}
	if app.RecordingStatus().Active {
		t.Fatal("recording remained active")
	}
}

func TestCallLogNewestFirstAndBounded(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/v1/audio/transcriptions" {
			_ = json.NewEncoder(w).Encode(map[string]string{"text": "words"})
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	cfg := DefaultConfig()
	pointASRAt(&cfg, server.URL+"/v1", "asr")
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	app.callLimit = 2
	data := base64.StdEncoding.EncodeToString([]byte("audio"))
	for i := 0; i < 3; i++ {
		if _, err := app.TranscribeAudio(AudioRequest{Data: data, Filename: "x.webm"}); err != nil {
			t.Fatalf("transcribe %d: %v", i, err)
		}
	}
	records := app.RecentCalls()
	if len(records) != 2 {
		t.Fatalf("call log length = %d, want the bounded 2", len(records))
	}
	if records[0].Kind != CallKindASR || records[1].ID == records[0].ID {
		t.Fatalf("records = %+v", records)
	}
	if records[0].StartedAt.Before(records[1].StartedAt) {
		t.Fatal("call log is not newest first")
	}
	app.ClearCalls()
	if len(app.RecentCalls()) != 0 {
		t.Fatal("ClearCalls left records behind")
	}
}

func TestAudioRequestAcceptsDataURL(t *testing.T) {
	r := AudioRequest{Data: "data:audio/webm;base64,YXVkaW8="}
	data, err := r.bytes()
	if err != nil || string(data) != "audio" {
		t.Fatalf("data URL decode = %q, err=%v", data, err)
	}
}

// capturePolishServer 记录每次 chat/completions 的 system 消息，
// 并返回一段固定文本；测试只关心预设如何影响这次调用。
func capturePolishServer(t *testing.T, systems *[]string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/audio/transcriptions":
			_ = json.NewEncoder(w).Encode(map[string]string{"text": "raw words"})
		case "/v1/chat/completions":
			var body struct {
				Messages []chatMessage `json:"messages"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode chat: %v", err)
				return
			}
			if len(body.Messages) > 0 {
				*systems = append(*systems, body.Messages[0].Content)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"choices": []any{map[string]any{"message": map[string]string{"content": "polished"}}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

func TestPolishTextUsesRequestedPreset(t *testing.T) {
	var systems []string
	server := capturePolishServer(t, &systems)
	defer server.Close()
	cfg := DefaultConfig()
	pointLLMAt(&cfg, server.URL+"/v1", "llm")
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}

	result, err := app.PolishText(PolishRequestDTO{Text: "raw", Language: "zh", PresetID: "concise"})
	if err != nil {
		t.Fatal(err)
	}
	if len(systems) != 1 || !strings.Contains(systems[0], "精简口述文本") {
		t.Fatalf("system message = %q, want the concise preset", systems)
	}
	if !strings.Contains(systems[0], listPolishInstructions) {
		t.Fatalf("list instructions missing from system message: %q", systems[0])
	}
	// 预设里带占位符，语言应替换进去而不是再追加英文句子。
	if strings.Contains(systems[0], languagePlaceholder) || !strings.Contains(systems[0], "zh") {
		t.Fatalf("language placeholder was not resolved: %q", systems[0])
	}
	if result.Call.Preset != "精简去重" {
		t.Fatalf("call preset = %q", result.Call.Preset)
	}
	// 调用记录要能说明这次用的是哪个模型。
	if result.Call.ModelID != cfg.LLM.Models[0].ID {
		t.Fatalf("call model id = %q", result.Call.ModelID)
	}

	// 未知预设 ID（例如刚被删除）回落到生效预设，而不是让调用失败。
	if err := app.SetActivePreset("meeting"); err != nil {
		t.Fatal(err)
	}
	result, err = app.PolishText(PolishRequestDTO{Text: "raw", PresetID: "gone"})
	if err != nil {
		t.Fatal(err)
	}
	if result.Call.Preset != "会议纪要" {
		t.Fatalf("fallback preset = %q, want the active one", result.Call.Preset)
	}
}

func TestPresetBindingRoutesToItsOwnModel(t *testing.T) {
	// 两套服务端分别代表「便宜模型」与「强模型」，用响应体区分
	// 实际命中的是哪一台。
	var cheapHits, strongHits int
	cheap := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cheapHits++
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "cheap"}}}})
	}))
	defer cheap.Close()
	strong := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		strongHits++
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "strong"}}}})
	}))
	defer strong.Close()

	cfg := DefaultConfig()
	pointLLMAt(&cfg, strong.URL+"/v1", "strong-model")
	cfg.LLM.Models = append(cfg.LLM.Models, LLMConfig{
		ID: "cheap", Name: "便宜模型", Provider: "openai-compatible",
		BaseURL: cheap.URL + "/v1", Model: "cheap-model",
	})
	// 「精简去重」绑定便宜模型，「会议纪要」跟随全局。
	for i := range cfg.LLM.Presets {
		if cfg.LLM.Presets[i].ID == "concise" {
			cfg.LLM.Presets[i].ModelID = "cheap"
		}
	}
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}

	if _, err := app.PolishText(PolishRequestDTO{Text: "raw", PresetID: "concise"}); err != nil {
		t.Fatal(err)
	}
	if cheapHits != 1 || strongHits != 0 {
		t.Fatalf("bound preset hit cheap=%d strong=%d", cheapHits, strongHits)
	}
	if _, err := app.PolishText(PolishRequestDTO{Text: "raw", PresetID: "meeting"}); err != nil {
		t.Fatal(err)
	}
	if strongHits != 1 {
		t.Fatalf("unbound preset should follow the active model, strong hits=%d", strongHits)
	}
}

func TestSetActiveModelSwitchesProviders(t *testing.T) {
	var firstHits, secondHits int
	respond := func(counter *int) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			*counter++
			_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": "ok"}}}})
		}
	}
	first := httptest.NewServer(respond(&firstHits))
	defer first.Close()
	second := httptest.NewServer(respond(&secondHits))
	defer second.Close()

	cfg := DefaultConfig()
	pointLLMAt(&cfg, first.URL+"/v1", "first")
	cfg.LLM.Models = append(cfg.LLM.Models, LLMConfig{
		ID: "second", Name: "第二个", Provider: "openai-compatible",
		BaseURL: second.URL + "/v1", Model: "second-model",
	})
	store := NewConfigStore(filepath.Join(t.TempDir(), "config.json"))
	app, err := NewAppWithConfig(cfg, store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := app.PolishText(PolishRequestDTO{Text: "raw"}); err != nil {
		t.Fatal(err)
	}
	if firstHits != 1 {
		t.Fatalf("first model hits = %d", firstHits)
	}
	if err := app.SetActiveModel("llm", "second"); err != nil {
		t.Fatal(err)
	}
	if _, err := app.PolishText(PolishRequestDTO{Text: "raw"}); err != nil {
		t.Fatal(err)
	}
	if secondHits != 1 {
		t.Fatalf("second model hits = %d", secondHits)
	}
	if err := app.SetActiveModel("llm", "missing"); err == nil {
		t.Fatal("unknown model id should be rejected")
	}
	if err := app.SetActiveModel("nope", "second"); err == nil {
		t.Fatal("unknown model kind should be rejected")
	}
	persisted, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if persisted.LLM.ActiveID != "second" {
		t.Fatalf("persisted active model = %q", persisted.LLM.ActiveID)
	}
}

func TestProcessAudioHonorsPresetID(t *testing.T) {
	var systems []string
	server := capturePolishServer(t, &systems)
	defer server.Close()
	cfg := DefaultConfig()
	pointASRAt(&cfg, server.URL+"/v1", "asr")
	pointLLMAt(&cfg, server.URL+"/v1", "llm")
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	data := base64.StdEncoding.EncodeToString([]byte("audio"))
	result, err := app.ProcessAudio(AudioRequest{Data: data, PresetID: "markdown"}, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Calls) != 2 || result.Calls[1].Preset != "Markdown 结构" {
		t.Fatalf("calls = %+v", result.Calls)
	}
	if len(systems) != 1 || !strings.Contains(systems[0], "结构化 Markdown") {
		t.Fatalf("system message = %q", systems)
	}
}

func TestSetActivePresetPersists(t *testing.T) {
	store := NewConfigStore(filepath.Join(t.TempDir(), "config.json"))
	app, err := NewAppWithConfig(DefaultConfig(), store)
	if err != nil {
		t.Fatal(err)
	}
	if err := app.SetActivePreset("  "); err == nil {
		t.Fatal("empty preset id should be rejected")
	}
	if err := app.SetActivePreset("missing"); err == nil {
		t.Fatal("unknown preset id should be rejected")
	}
	if err := app.SetActivePreset("meeting"); err != nil {
		t.Fatal(err)
	}
	if got := app.Config().LLM.ActivePresetID; got != "meeting" {
		t.Fatalf("active preset = %q", got)
	}
	reloaded, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	if reloaded.LLM.ActivePresetID != "meeting" {
		t.Fatalf("persisted active preset = %q", reloaded.LLM.ActivePresetID)
	}
}

func TestSaveConfigKeepsPresetsAndModelsForLegacyPayloads(t *testing.T) {
	store := NewConfigStore(filepath.Join(t.TempDir(), "config.json"))
	app, err := NewAppWithConfig(DefaultConfig(), store)
	if err != nil {
		t.Fatal(err)
	}
	withCustom := app.Config()
	withCustom.LLM.Presets = []PolishPreset{{ID: "x", Name: "我的整理", SystemPrompt: "prompt x"}}
	withCustom.LLM.ActivePresetID = "x"
	if err := app.SaveConfig(withCustom); err != nil {
		t.Fatal(err)
	}

	// 老客户端只发 ASR/LLM 字段，JSON 里没有 presets 与 models。
	legacy := app.Config()
	legacy.LLM.Presets = nil
	legacy.LLM.ActivePresetID = ""
	legacy.ASR.Models = nil
	legacy.LLM.Models = nil
	if err := app.SaveConfig(legacy); err != nil {
		t.Fatal(err)
	}
	if got := app.Config().LLM.Presets; len(got) != 1 || got[0].ID != "x" {
		t.Fatalf("presets after legacy save = %+v", got)
	}
	if got := app.Config().LLM.Models; len(got) != 1 || got[0].ID != defaultModelID {
		t.Fatalf("models after legacy save = %+v", got)
	}

	// 显式清空预设在保存阶段就该失败，不能落盘成一份没有提示词的配置。
	empty := app.Config()
	empty.LLM.Presets = []PolishPreset{}
	if err := app.SaveConfig(empty); err == nil {
		t.Fatal("empty preset list should be rejected")
	}
}

func TestSaveDesktopConfigPreservesModelConfig(t *testing.T) {
	cfg := DefaultConfig()
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	updated := app.GetDesktopConfig()
	updated.Hotkey = "Alt+Space"
	updated.AutoPaste = false
	if err := app.SaveDesktopConfig(updated); err != nil {
		t.Fatal(err)
	}
	if got := app.GetDesktopConfig(); got.Hotkey != "Alt+Space" || got.AutoPaste {
		t.Fatalf("desktop settings = %+v", got)
	}
	if got := app.Config().LLM.Models[0].Model; got == "" {
		t.Fatal("saving desktop config cleared the model config")
	}
}
