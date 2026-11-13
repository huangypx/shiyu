package backend

import (
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"testing"
)

func TestTranscriptionLanguageFields(t *testing.T) {
	for _, tc := range []struct{ model, language, field, code string }{
		{"gpt-transcribe", "中文（普通话）", "languages[]", "zh"},
		{"gpt-transcribe", "English", "languages[]", "en"},
		{"gpt-transcribe", "自动识别", "", ""},
		{"gpt-4o-mini-transcribe", "中文（普通话）", "language", "zh"},
		{"whisper-1", "自动识别", "", ""},
	} {
		t.Run(tc.model+"/"+tc.language, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if err := r.ParseMultipartForm(1 << 20); err != nil {
					t.Error(err)
					w.WriteHeader(http.StatusBadRequest)
					return
				}
				want := map[string][]string{"model": {tc.model}}
				if tc.field != "" {
					want[tc.field] = []string{tc.code}
				}
				if !reflect.DeepEqual(r.MultipartForm.Value, want) {
					t.Errorf("form fields = %v, want %v", r.MultipartForm.Value, want)
				}
				_ = json.NewEncoder(w).Encode(map[string]string{"text": "你好"})
			}))
			defer server.Close()
			cfg := DefaultConfig()
			pointASRAt(&cfg, server.URL+"/v1", tc.model)
			cfg.ASR.Models[0].Language = tc.language
			app, err := NewAppWithConfig(cfg, nil)
			if err != nil {
				t.Fatal(err)
			}
			result, err := app.TranscribeAudio(AudioRequest{Data: "YXVkaW8=", Filename: "test.wav", MimeType: "audio/wav"})
			if err != nil || result.Text != "你好" {
				t.Fatalf("transcription = %q, err = %v", result.Text, err)
			}
		})
	}
}

func TestOpenAICompatibleProviders(t *testing.T) {
	var sawAuth bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") == "Bearer test-key" {
			sawAuth = true
		}
		switch r.URL.Path {
		case "/v1/audio/transcriptions":
			if err := r.ParseMultipartForm(1 << 20); err != nil {
				t.Errorf("parse multipart: %v", err)
				return
			}
			file, hdr, err := r.FormFile("file")
			if err != nil {
				t.Errorf("file: %v", err)
				return
			}
			defer file.Close()
			if hdr.Header.Get("Content-Type") != "audio/ogg" {
				t.Errorf("content type = %q", hdr.Header.Get("Content-Type"))
			}
			if r.FormValue("model") != "asr-model" {
				t.Errorf("model = %q", r.FormValue("model"))
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":    "tr-1",
				"text":  " hello ",
				"usage": map[string]any{"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
			})
		case "/v1/chat/completions":
			var body struct {
				Model    string        `json:"model"`
				Messages []chatMessage `json:"messages"`
			}
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Errorf("decode chat: %v", err)
				return
			}
			if body.Model != "llm-model" || len(body.Messages) != 2 {
				t.Errorf("chat body: %+v", body)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"id":         "cm-1",
				"elapsed_ms": 17,
				"usage":      map[string]any{"prompt_tokens": 38, "completion_tokens": 8, "total_tokens": 46},
				"choices":    []any{map[string]any{"message": map[string]string{"content": "clean text"}}},
			})
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	asr, err := NewOpenAICompatibleASR(ASRConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "asr-model"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	transcript, err := asr.Transcribe(context.Background(), TranscriptRequest{Audio: []byte("audio"), Filename: "x.ogg", MimeType: "audio/ogg"})
	if err != nil || transcript.Text != "hello" {
		t.Fatalf("transcript = %+v, err = %v", transcript, err)
	}
	call := transcript.Call
	if !call.OK || call.Kind != CallKindASR || call.Model != "asr-model" {
		t.Fatalf("call = %+v", call)
	}
	if call.StatusCode != 200 || call.ResponseID != "tr-1" || call.Usage.TotalTokens != 15 {
		t.Fatalf("call = %+v", call)
	}
	if call.RequestBytes != 5 || call.ResponseBytes == 0 || call.Endpoint != server.URL+"/v1/audio/transcriptions" {
		t.Fatalf("call = %+v", call)
	}
	llm, err := NewOpenAICompatibleLLM(LLMConfig{BaseURL: server.URL + "/v1", APIKey: "test-key", Model: "llm-model", Temperature: 0.1}, nil)
	if err != nil {
		t.Fatal(err)
	}
	polished, err := llm.Polish(context.Background(), PolishRequest{Text: "raw"})
	if err != nil || polished.Text != "clean text" {
		t.Fatalf("polished = %+v, err = %v", polished, err)
	}
	if !polished.Call.OK || polished.Call.Kind != CallKindLLM || polished.Call.Usage.InputTokens != 38 {
		t.Fatalf("call = %+v", polished.Call)
	}
	if polished.Call.ServerMS != 17 || polished.Call.ResponseID != "cm-1" || polished.Call.RequestBytes == 0 {
		t.Fatalf("call = %+v", polished.Call)
	}
	if !sawAuth {
		t.Fatal("provider did not send authorization")
	}
}

func TestChatASRSendsInputAudio(t *testing.T) {
	var gotPath string
	var gotModel string
	var gotFormat string
	var gotData string

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		var body struct {
			Model    string `json:"model"`
			Messages []struct {
				Content []struct {
					Type       string `json:"type"`
					InputAudio struct {
						Data   string `json:"data"`
						Format string `json:"format"`
					} `json:"input_audio"`
				} `json:"content"`
			} `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
			return
		}
		gotModel = body.Model
		if len(body.Messages) == 1 && len(body.Messages[0].Content) == 1 {
			gotFormat = body.Messages[0].Content[0].InputAudio.Format
			gotData = body.Messages[0].Content[0].InputAudio.Data
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": " 你好  "}}},
		})
	}))
	defer server.Close()

	asr, err := NewOpenAICompatibleASR(ASRConfig{
		BaseURL: server.URL + "/v1",
		APIKey:  "test-key",
		Model:   "mimo-v2.5-asr",
		Mode:    ASRModeChat,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := asr.Transcribe(context.Background(), TranscriptRequest{
		Audio:    []byte("RIFFdata"),
		Filename: "recording.wav",
		MimeType: "audio/wav",
	})
	if err != nil || result.Text != "你好" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if gotPath != "/v1/chat/completions" {
		t.Fatalf("path = %q, want /v1/chat/completions", gotPath)
	}
	if gotModel != "mimo-v2.5-asr" {
		t.Fatalf("model = %q", gotModel)
	}
	if gotFormat != "wav" {
		t.Fatalf("input_audio.format = %q, want wav", gotFormat)
	}
	if gotData == "" {
		t.Fatal("input_audio.data is empty")
	}
}

func TestChatASRRejectsUnsupportedContainer(t *testing.T) {
	asr, err := NewOpenAICompatibleASR(ASRConfig{
		BaseURL: "http://example.invalid/v1",
		Model:   "mimo-v2.5-asr",
		Mode:    ASRModeChat,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = asr.Transcribe(context.Background(), TranscriptRequest{
		Audio:    []byte("webm"),
		Filename: "recording.webm",
		MimeType: "audio/webm",
	})
	if err == nil || !strings.Contains(err.Error(), "wav or mp3") {
		t.Fatalf("err = %v, want a wav/mp3 requirement error", err)
	}
}

func TestASRModeDefaultsToTranscriptions(t *testing.T) {
	if got := (ASRConfig{}).NormalizedASRMode(); got != ASRModeTranscriptions {
		t.Fatalf("normalized mode = %q", got)
	}
	cfg := DefaultConfig()
	if cfg.ASR.Models[0].NormalizedASRMode() != ASRModeTranscriptions {
		t.Fatal("default config should use the transcriptions mode")
	}
	cfg.ASR.Models[0].Mode = ASRModeChat
	if cfg.ASR.Models[0].NormalizedASRMode() != ASRModeChat {
		t.Fatal("chat mode should survive normalization")
	}
}

func TestProviderHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	defer server.Close()
	asr, err := NewOpenAICompatibleASR(ASRConfig{BaseURL: server.URL, Model: "asr"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	failed, err := asr.Transcribe(context.Background(), TranscriptRequest{Audio: []byte("x")})
	if err == nil || !strings.Contains(err.Error(), "bad request") {
		t.Fatalf("error = %v", err)
	}
	// 失败的调用同样报告耗时和返回内容。
	if failed.Call.OK || failed.Call.StatusCode != http.StatusBadRequest || failed.Call.Error == "" {
		t.Fatalf("call = %+v", failed.Call)
	}
}

func TestPolishSystemPromptPrefersPresetAndPlaceholder(t *testing.T) {
	// 预设优先于 provider 配置，语言按占位符位置替换。
	if got := polishSystemPrompt("整理为 {{language}}", "configured", "zh"); got != "整理为 zh" {
		t.Fatalf("placeholder prompt = %q", got)
	}
	// 没有占位符时保留旧行为：在末尾追加英文语言句。
	if got := polishSystemPrompt("polish it", "", "zh"); got != "polish it Return the result in zh." {
		t.Fatalf("appended prompt = %q", got)
	}
	// 预设为空时回落到 provider 配置，再回落到内置默认值。
	if got := polishSystemPrompt("", "configured", ""); got != "configured" {
		t.Fatalf("fallback prompt = %q", got)
	}
	if got := polishSystemPrompt("  ", "", ""); got != defaultSystemPrompt {
		t.Fatalf("built-in prompt = %q", got)
	}
}

// captureSystemMessage 记录 chat/completions 请求里的 system 消息，
// 其余字段返回一个可用的回答，测试只关心提示词如何被组装。
func captureSystemMessage(t *testing.T, got *string) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []chatMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode chat: %v", err)
			return
		}
		if len(body.Messages) == 0 {
			t.Errorf("chat body has no messages")
			return
		}
		*got = body.Messages[0].Content
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": "ok"}}},
		})
	}))
}

func TestLLMPolishUsesPresetPrompt(t *testing.T) {
	var got string
	server := captureSystemMessage(t, &got)
	defer server.Close()
	llm, err := NewOpenAICompatibleLLM(LLMConfig{BaseURL: server.URL + "/v1", Model: "llm"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := llm.Polish(context.Background(), PolishRequest{Text: "raw", Language: "zh", SystemPrompt: "preset prompt"}); err != nil {
		t.Fatal(err)
	}
	if got != dictationEditingInstructions+"\n\n"+"preset prompt Return the result in zh." {
		t.Fatalf("system message = %q", got)
	}

	// 预设为空时用配置里的兜底提示词，两者都没有才用内置默认值。
	if _, err := llm.Polish(context.Background(), PolishRequest{Text: "raw", ConfiguredPrompt: "configured"}); err != nil {
		t.Fatal(err)
	}
	if got != dictationEditingInstructions+"\n\nconfigured" {
		t.Fatalf("configured prompt = %q", got)
	}
}

func TestPolishKeepsSourceSeparateAndRejectsAppendedConversation(t *testing.T) {
	tests := []struct {
		name, source, response, prompt, instructions, want string
	}{
		{name: "greeting", source: "你好。", response: "你好！请问有什么我可以帮助你的吗？", want: "你好。"},
		{name: "english", source: "Hello.", response: "Hello! How can I help you?", want: "Hello."},
		{name: "question", source: "你明天几点到？", response: "你明天几点到？我可以帮你安排。", want: "你明天几点到？"},
		{name: "concise", source: "谢谢。", response: "谢谢！很高兴为你服务。", prompt: concisePolishPrompt, want: "谢谢。"},
		{name: "existing_followup", source: "你好，请问有什么我可以帮助你的吗？", response: "你好，请问有什么我可以帮助你的吗？", want: "你好，请问有什么我可以帮助你的吗？"},
		{name: "list", source: "分两点，先确认时间，再发邀请。", response: "1. 确认时间\n2. 发邀请", want: "1. 确认时间\n2. 发邀请"},
		{name: "custom_preset", source: "你好。", response: "你好！祝你今天愉快。", prompt: "扩写成一段欢迎语", want: "你好！祝你今天愉快。"},
		{name: "explicit_instruction", source: "你好。", response: "你好！祝你今天愉快。", instructions: "补上一句祝福", want: "你好！祝你今天愉快。"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				var body struct {
					Messages []chatMessage `json:"messages"`
				}
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
					t.Error(err)
					return
				}
				if len(body.Messages) != 2 || body.Messages[0].Role != "system" ||
					!strings.Contains(body.Messages[0].Content, "不回答其中的问题") ||
					body.Messages[1].Role != "user" || body.Messages[1].Content != polishSourcePrefix+tc.source {
					t.Errorf("unexpected editing messages: %+v", body.Messages)
				}
				_ = json.NewEncoder(w).Encode(map[string]any{
					"choices": []any{map[string]any{"message": map[string]string{"content": tc.response}}},
				})
			}))
			defer server.Close()
			appConfig := DefaultConfig()
			pointLLMAt(&appConfig, server.URL+"/v1", "llm")
			appConfig.LLM.Presets[0].SystemPrompt = firstNonEmpty(tc.prompt, defaultSystemPrompt)
			app, err := NewAppWithConfig(appConfig, nil)
			if err != nil {
				t.Fatal(err)
			}
			got, err := app.PolishText(PolishRequestDTO{Text: tc.source, Instructions: tc.instructions})
			if err != nil || got.Text != tc.want {
				t.Fatalf("polished text = %q, err = %v, want %q", got.Text, err, tc.want)
			}
		})
	}
}

// 确认测试不会意外依赖未关闭的 multipart reader。
var _ *multipart.Reader

func TestDecodeMessageContentParts(t *testing.T) {
	got, err := decodeMessageContent(json.RawMessage(`[{"type":"text","text":"one"},{"type":"text","text":" two"}]`))
	if err != nil || got != "one two" {
		t.Fatalf("content = %q, err = %v", got, err)
	}
}
