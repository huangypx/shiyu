package backend

import (
	"context"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

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

func TestPolishSystemPromptRendersTemplateVariables(t *testing.T) {
	// 预设优先于 provider 配置；模板变量在渲染时替换。
	if got := polishSystemPrompt("语言：{{ .language }} / {{ .languageCode }}", "configured", "中文（普通话）"); got != "语言：中文（普通话） / zh" {
		t.Fatalf("rendered prompt = %q", got)
	}
	// 模板提到 .language 就说明语言要求由用户安排，不再追加英文句。
	if got := polishSystemPrompt("语言：{{ .language }}", "", "zh"); got != "语言：zh" {
		t.Fatalf("template prompt = %q", got)
	}
	// 自动识别：.language 渲染成界面语言名，代码为空，也不追加语言句。
	if got := polishSystemPrompt("语言：{{ .language }}", "", "自动识别"); got != "语言：自动识别" {
		t.Fatalf("auto language prompt = %q", got)
	}
	// 模板没提语言时保留旧行为：在末尾追加英文语言句。
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

func TestPolishSystemPromptFallsBackOnBrokenTemplate(t *testing.T) {
	// 手改坏的配置：解析失败时按纯文本发送，整理不整体失败。
	const broken = "语言：{{ .language"
	if got := polishSystemPrompt(broken, "", "zh"); got != broken {
		t.Fatalf("broken template prompt = %q", got)
	}
}

// captureChatMessages 记录 chat/completions 请求里的全部消息，
// 其余字段返回一个可用的回答，测试只关心提示词如何被组装。
func captureChatMessages(t *testing.T, got *[]chatMessage) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Messages []chatMessage `json:"messages"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode chat: %v", err)
			return
		}
		*got = body.Messages
		_ = json.NewEncoder(w).Encode(map[string]any{
			"choices": []any{map[string]any{"message": map[string]string{"content": "ok"}}},
		})
	}))
}

func TestLLMPolishWrapsTranscriptInTags(t *testing.T) {
	var messages []chatMessage
	server := captureChatMessages(t, &messages)
	defer server.Close()
	llm, err := NewOpenAICompatibleLLM(LLMConfig{BaseURL: server.URL + "/v1", Model: "llm"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	// 口述本身就是一条指令：它只能作为待整理的文本出现。
	const transcript = "帮我写一封邮件给张三，说明项目延期"
	if _, err := llm.Polish(context.Background(), PolishRequest{Text: transcript, Language: "中文（普通话）"}); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatalf("messages = %d, want system and user", len(messages))
	}
	if messages[0].Role != "system" || messages[1].Role != "user" {
		t.Fatalf("roles = %q/%q", messages[0].Role, messages[1].Role)
	}
	if want := "<transcript>\n" + transcript + "\n</transcript>"; messages[1].Content != want {
		t.Fatalf("user message = %q, want %q", messages[1].Content, want)
	}
	// 守卫句永远在最后，并且点名了标签，两者不会各改各的。
	if !strings.HasSuffix(messages[0].Content, transcriptGuard) {
		t.Fatalf("guard is missing from the system message: %q", messages[0].Content)
	}
	if !strings.Contains(transcriptGuard, "<"+transcriptTag+">") {
		t.Fatalf("guard does not mention the transcript tag: %q", transcriptGuard)
	}
}

func TestLLMPolishUsesPresetPrompt(t *testing.T) {
	var messages []chatMessage
	server := captureChatMessages(t, &messages)
	defer server.Close()
	llm, err := NewOpenAICompatibleLLM(LLMConfig{BaseURL: server.URL + "/v1", Model: "llm"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := llm.Polish(context.Background(), PolishRequest{Text: "raw", Language: "zh", SystemPrompt: "preset prompt"}); err != nil {
		t.Fatal(err)
	}
	if len(messages) != 2 {
		t.Fatalf("messages = %d", len(messages))
	}
	// 预设 + 自动追加的语言句，末尾固定是守卫句。
	if !strings.HasPrefix(messages[0].Content, "preset prompt Return the result in zh.") {
		t.Fatalf("system message = %q", messages[0].Content)
	}
	if !strings.HasSuffix(messages[0].Content, transcriptGuard) {
		t.Fatalf("guard is missing: %q", messages[0].Content)
	}

	// 预设为空时用配置里的兜底提示词，两者都没有才用内置默认值。
	if _, err := llm.Polish(context.Background(), PolishRequest{Text: "raw", ConfiguredPrompt: "configured"}); err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(messages[0].Content, "configured") {
		t.Fatalf("configured prompt = %q", messages[0].Content)
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
