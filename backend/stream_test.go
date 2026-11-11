package backend

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"
)

// streamConfig 把生效的 ASR 模型指向 httptest 服务器并打开流式开关。
func streamConfig(baseURL string) Config {
	cfg := DefaultConfig()
	pointASRAt(&cfg, baseURL+"/v1", "mimo-v2.5-asr")
	cfg.ASR.Models[0].Mode = ASRModeChat
	cfg.ASR.Models[0].Stream = true
	return cfg
}

func TestChatASRStreamsDeltas(t *testing.T) {
	var sawStream bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Stream bool `json:"stream"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode: %v", err)
			return
		}
		sawStream = body.Stream
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		flusher, _ := w.(http.Flusher)
		write := func(payload any) {
			encoded, _ := json.Marshal(payload)
			fmt.Fprintf(w, "data: %s\n\n", encoded)
			if flusher != nil {
				flusher.Flush()
			}
		}
		for _, delta := range []string{"你", "好", "世界"} {
			write(map[string]any{
				"id":      "tr-1",
				"choices": []any{map[string]any{"delta": map[string]string{"content": delta}}},
			})
		}
		write(map[string]any{
			"id":      "tr-1",
			"choices": []any{map[string]any{"delta": map[string]string{}, "finish_reason": "stop"}},
			"usage":   map[string]any{"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8},
		})
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	asr, err := NewOpenAICompatibleASR(ASRConfig{
		BaseURL: server.URL + "/v1",
		Model:   "mimo-v2.5-asr",
		Mode:    ASRModeChat,
		Stream:  true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	var deltas []string
	result, err := asr.Transcribe(context.Background(), TranscriptRequest{
		Audio:    []byte("RIFFdata"),
		Filename: "recording.wav",
		MimeType: "audio/wav",
		Stream:   true,
		OnDelta:  func(text string) { deltas = append(deltas, text) },
	})
	if err != nil {
		t.Fatalf("transcribe: %v", err)
	}
	if !sawStream {
		t.Fatal("request did not ask for streaming")
	}
	if result.Text != "你好世界" {
		t.Fatalf("text = %q", result.Text)
	}
	want := []string{"你", "你好", "你好世界"}
	if len(deltas) != len(want) {
		t.Fatalf("deltas = %v, want %v", deltas, want)
	}
	for i := range want {
		if deltas[i] != want[i] {
			t.Fatalf("deltas = %v, want %v", deltas, want)
		}
	}
	if !result.Call.OK || result.Call.ResponseID != "tr-1" || result.Call.Usage.TotalTokens != 8 {
		t.Fatalf("call = %+v", result.Call)
	}
	if result.Call.FinishReason != "stop" || result.Call.ResponseBytes == 0 {
		t.Fatalf("call = %+v", result.Call)
	}
}

func TestChatASRStreamFallsBackToJSON(t *testing.T) {
	// 网关直接忽略 stream 参数：响应仍是普通 JSON，行为必须与
	// 关闭流式时一致，否则开关一打开就会坏。
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "tr-2",
			"choices": []any{map[string]any{"message": map[string]string{"content": " 整段结果 "}, "finish_reason": "stop"}},
		})
	}))
	defer server.Close()

	asr, err := NewOpenAICompatibleASR(ASRConfig{
		BaseURL: server.URL + "/v1",
		Model:   "mimo-v2.5-asr",
		Mode:    ASRModeChat,
		Stream:  true,
	}, nil)
	if err != nil {
		t.Fatal(err)
	}
	result, err := asr.Transcribe(context.Background(), TranscriptRequest{
		Audio:    []byte("RIFFdata"),
		Filename: "recording.wav",
		MimeType: "audio/wav",
		Stream:   true,
		OnDelta:  func(string) { t.Fatal("fallback response should not emit deltas") },
	})
	if err != nil || result.Text != "整段结果" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if result.Call.ResponseID != "tr-2" || !result.Call.OK {
		t.Fatalf("call = %+v", result.Call)
	}
}

func TestTranscribePushesPartialText(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"你好\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer server.Close()

	cfg := streamConfig(server.URL)
	app, err := NewAppWithConfig(cfg, NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	var partials []string
	AttachEmitter(app, func(name string, data any) {
		if name != EventASRPartial {
			t.Fatalf("unexpected event %q", name)
		}
		partials = append(partials, data.(PartialText).Text)
	})
	data := base64.StdEncoding.EncodeToString([]byte("RIFFdata"))
	result, err := app.TranscribeAudio(AudioRequest{Data: data, Filename: "x.wav", MimeType: "audio/wav"})
	if err != nil || result.Text != "你好" {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if len(partials) != 1 || partials[0] != "你好" {
		t.Fatalf("partials = %v", partials)
	}
}

func TestCancelTranscriptionStopsRequest(t *testing.T) {
	started := make(chan struct{})
	// release 只是兜底：万一取消没传到底层连接，测试也不该挂死
	// 在 server.Close 上。
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 必须先把请求体读完，net/http 才会开始后台读并在连接断开
		// 时取消 r.Context()。
		_, _ = io.Copy(io.Discard, r.Body)
		close(started)
		select {
		case <-r.Context().Done():
		case <-release:
		}
	}))
	defer func() {
		close(release)
		server.Close()
	}()

	app, err := NewAppWithConfig(streamConfig(server.URL), NewConfigStore(filepath.Join(t.TempDir(), "config.json")))
	if err != nil {
		t.Fatal(err)
	}
	go func() {
		<-started
		if err := app.CancelTranscription(); err != nil {
			t.Errorf("cancel: %v", err)
		}
	}()
	data := base64.StdEncoding.EncodeToString([]byte("RIFFdata"))
	if _, err := app.TranscribeAudio(AudioRequest{Data: data, Filename: "x.wav", MimeType: "audio/wav"}); err == nil {
		t.Fatal("expected cancellation error")
	}
	// 没有在途请求时应是空操作，可以重复调用。
	if err := app.CancelTranscription(); err != nil {
		t.Fatalf("second cancel: %v", err)
	}
}

func TestPartialPumpThrottlesAndFlushesTail(t *testing.T) {
	var sent []string
	pump := newPartialPump(func(name string, data any) {
		if name != EventASRPartial {
			t.Fatalf("unexpected event %q", name)
		}
		sent = append(sent, data.(PartialText).Text)
	})
	current := time.Unix(0, 0)
	pump.now = func() time.Time { return current }

	pump.push("你")
	pump.push("你好") // 间隔内，被节流
	current = current.Add(partialInterval)
	pump.push("你好世界")
	pump.done() // 没有更新的文本，不重复推送

	if len(sent) != 2 || sent[0] != "你" || sent[1] != "你好世界" {
		t.Fatalf("sent = %v", sent)
	}

	// 末帧必须补发，界面才能停在最终文本上。
	pump.push("你好世界！")
	pump.done()
	if len(sent) != 3 || sent[2] != "你好世界！" {
		t.Fatalf("sent = %v", sent)
	}
}
