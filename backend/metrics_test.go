package backend

import (
	"encoding/binary"
	"testing"
)

func TestParseUsage(t *testing.T) {
	audio := parseUsage([]byte(`{"prompt_tokens":28,"completion_tokens":9,"total_tokens":37,"prompt_tokens_details":{"audio_tokens":7,"cached_tokens":4},"completion_tokens_details":{"reasoning_tokens":5},"seconds":2.5}`))
	if audio.InputTokens != 28 || audio.OutputTokens != 9 || audio.TotalTokens != 37 {
		t.Fatalf("usage = %+v", audio)
	}
	if audio.AudioTokens != 7 || audio.CachedTokens != 4 || audio.ReasoningTokens != 5 {
		t.Fatalf("usage details = %+v", audio)
	}
	if audio.ProviderSeconds != 2.5 || audio.Raw == "" {
		t.Fatalf("usage = %+v", audio)
	}

	// 服务商可能使用较新的 input/output 命名，并省略 total_tokens。
	alternate := parseUsage([]byte(`{"input_tokens":10,"output_tokens":5}`))
	if alternate.InputTokens != 10 || alternate.OutputTokens != 5 || alternate.TotalTokens != 15 {
		t.Fatalf("usage = %+v", alternate)
	}

	for _, raw := range [][]byte{nil, []byte("null"), []byte(""), []byte("not json")} {
		if got := parseUsage(raw); got != (TokenUsage{}) {
			t.Fatalf("usage for %q = %+v", raw, got)
		}
	}
}

func TestWavDurationSeconds(t *testing.T) {
	wav := testWAV(32000, 32000)
	if got := wavDurationSeconds(wav); got < 0.99 || got > 1.01 {
		t.Fatalf("duration = %f, want 1s", got)
	}
	// 一半的负载对应半秒音频。
	if got := wavDurationSeconds(testWAV(32000, 16000)); got < 0.49 || got > 0.51 {
		t.Fatalf("duration = %f, want 0.5s", got)
	}
	if got := wavDurationSeconds([]byte("RIFFxxxxWAVE")); got != 0 {
		t.Fatalf("non-wav duration = %f", got)
	}
	if got := wavDurationSeconds(wav[:20]); got != 0 {
		t.Fatalf("truncated duration = %f", got)
	}
	if got := wavDurationSeconds(nil); got != 0 {
		t.Fatalf("empty duration = %f", got)
	}
}

func TestSanitizeEndpoint(t *testing.T) {
	cases := map[string]string{
		"https://user:secret@api.example.com/v1/chat/completions?api_key=abc#frag": "https://api.example.com/v1/chat/completions",
		"http://127.0.0.1:9000/v1/audio/transcriptions":                            "http://127.0.0.1:9000/v1/audio/transcriptions",
		"  ":  "",
		":::": "",
	}
	for raw, want := range cases {
		if got := sanitizeEndpoint(raw); got != want {
			t.Fatalf("sanitizeEndpoint(%q) = %q, want %q", raw, got, want)
		}
	}
}

func TestTruncateKeepsValidUTF8(t *testing.T) {
	if got := truncate("  short  ", 40); got != "short" {
		t.Fatalf("truncate = %q", got)
	}
	// 在多字节 rune 中间截断，不能产生非法 UTF-8。
	long := "中文中文中文中文"
	got := truncate(long, 7)
	if len(got) == 0 || got[len(got)-1] == 0xFF {
		t.Fatalf("truncate = %q", got)
	}
	for _, r := range got {
		if r == '�' {
			t.Fatalf("truncate produced a replacement character: %q", got)
		}
	}
}

// testWAV 构造最小的 PCM WAV 头，这样测试时长解析器时
// 不需要额外的样例文件。
func testWAV(byteRate, dataBytes int) []byte {
	buf := make([]byte, 0, 44+dataBytes)
	buf = append(buf, []byte("RIFF")...)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(36+dataBytes))
	buf = append(buf, []byte("WAVE")...)
	buf = append(buf, []byte("fmt ")...)
	buf = binary.LittleEndian.AppendUint32(buf, 16)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint16(buf, 1)
	buf = binary.LittleEndian.AppendUint32(buf, 16000)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(byteRate))
	buf = binary.LittleEndian.AppendUint16(buf, 2)
	buf = binary.LittleEndian.AppendUint16(buf, 16)
	buf = append(buf, []byte("data")...)
	buf = binary.LittleEndian.AppendUint32(buf, uint32(dataBytes))
	return append(buf, make([]byte, dataBytes)...)
}
