package backend

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"sync/atomic"
	"time"
)

// CallKindASR 和 CallKindLLM 标记应用会发起的两种服务商往返，
// 也是 CallRecord.Kind 的取值。
const (
	CallKindASR = "asr"
	CallKindLLM = "llm"
)

// defaultCallLimit 限制内存中的调用记录条数。单条记录很小（一个
// usage 对象加几个计数器），几百条依然廉价，同时足以覆盖
// 一次较长的工作会话。
const defaultCallLimit = 200

// usage 对象或错误响应体可能任意大；日志只保留有用的开头部分，
// 不把整个负载留在内存里。
const (
	maxUsageRawBytes = 2048
	maxErrorBytes    = 300
)

// TokenUsage 是服务商 usage 对象的归一化视图。
// 省略 usage 的服务商会让计数保持为 0；Raw 保留原始对象，
// 以便调试非标准网关。
type TokenUsage struct {
	InputTokens     int     `json:"inputTokens"`
	OutputTokens    int     `json:"outputTokens"`
	TotalTokens     int     `json:"totalTokens"`
	AudioTokens     int     `json:"audioTokens,omitempty"`
	CachedTokens    int     `json:"cachedTokens,omitempty"`
	ReasoningTokens int     `json:"reasoningTokens,omitempty"`
	ProviderSeconds float64 `json:"providerSeconds,omitempty"`
	Raw             string  `json:"raw,omitempty"`
}

// CallRecord 描述一次服务商往返：耗时多久、消耗多少 token，
// 失败时还有原因。记录由服务商实现产生，因此失败的尝试同样
// 带有状态码和耗时。
type CallRecord struct {
	ID       string `json:"id"`
	Kind     string `json:"kind"`
	Provider string `json:"provider"`
	Model    string `json:"model"`
	Mode     string `json:"mode,omitempty"`
	// Preset 是这次整理用的预设名称，按调用时的名字记录，
	// 之后改名不会改写已经产生的记录。
	Preset string `json:"preset,omitempty"`
	// ModelID 是本次调用实际使用的模型 ID。多模型配置下，
	// 只看 model 字段无法区分同名的不同端点。
	ModelID       string     `json:"modelId,omitempty"`
	Endpoint      string     `json:"endpoint"`
	StartedAt     time.Time  `json:"startedAt"`
	DurationMS    int64      `json:"durationMs"`
	ServerMS      int64      `json:"serverMs,omitempty"`
	FinishReason  string     `json:"finishReason,omitempty"`
	StatusCode    int        `json:"statusCode,omitempty"`
	RequestID     string     `json:"requestId,omitempty"`
	ResponseID    string     `json:"responseId,omitempty"`
	RequestBytes  int        `json:"requestBytes,omitempty"`
	ResponseBytes int        `json:"responseBytes,omitempty"`
	AudioSeconds  float64    `json:"audioSeconds,omitempty"`
	Usage         TokenUsage `json:"usage"`
	OK            bool       `json:"ok"`
	Error         string     `json:"error,omitempty"`
}

var callSequence atomic.Int64

// newCallRecord 在请求发出前先建好记录。
// endpoint 由调用方回填，因为它取决于最终
// 选用的模式。
func newCallRecord(kind, provider, model string) CallRecord {
	return CallRecord{
		ID:        fmt.Sprintf("%d-%d", time.Now().UnixNano(), callSequence.Add(1)),
		Kind:      kind,
		Provider:  strings.TrimSpace(provider),
		Model:     strings.TrimSpace(model),
		StartedAt: time.Now(),
	}
}

// parseUsage 归一化 OpenAI 兼容响应里的 usage 对象。
// 文本与音频端点的结构不同，第三方网关还会附加自己的字段，
// 因此每个值都是可选的。
func parseUsage(raw []byte) TokenUsage {
	usage := TokenUsage{}
	if len(raw) == 0 || string(raw) == "null" {
		return usage
	}
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(raw, &fields); err != nil {
		return usage
	}
	usage.InputTokens = firstInt(fields, "prompt_tokens", "input_tokens")
	usage.OutputTokens = firstInt(fields, "completion_tokens", "output_tokens")
	usage.TotalTokens = firstInt(fields, "total_tokens")
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.InputTokens + usage.OutputTokens
	}
	usage.AudioTokens = firstInt(fields, "audio_tokens")
	usage.CachedTokens = firstInt(fields, "cached_tokens", "prompt_cache_hit_tokens")
	usage.ReasoningTokens = firstInt(fields, "reasoning_tokens", "completion_thinking_tokens")
	usage.ProviderSeconds = firstFloat(fields, "seconds")
	if nested := nestedFields(fields, "prompt_tokens_details"); nested != nil {
		if value := firstInt(nested, "audio_tokens"); value != 0 {
			usage.AudioTokens = value
		}
		if value := firstInt(nested, "cached_tokens"); value != 0 {
			usage.CachedTokens = value
		}
	}
	if nested := nestedFields(fields, "completion_tokens_details"); nested != nil {
		if value := firstInt(nested, "reasoning_tokens"); value != 0 {
			usage.ReasoningTokens = value
		}
	}
	usage.Raw = truncate(string(raw), maxUsageRawBytes)
	return usage
}

func nestedFields(fields map[string]json.RawMessage, key string) map[string]json.RawMessage {
	raw, ok := fields[key]
	if !ok {
		return nil
	}
	var nested map[string]json.RawMessage
	if err := json.Unmarshal(raw, &nested); err != nil {
		return nil
	}
	return nested
}

func firstInt(fields map[string]json.RawMessage, keys ...string) int {
	for _, key := range keys {
		raw, ok := fields[key]
		if !ok {
			continue
		}
		var number json.Number
		if err := json.Unmarshal(raw, &number); err != nil {
			continue
		}
		if value, err := number.Int64(); err == nil {
			return int(value)
		}
		if value, err := number.Float64(); err == nil {
			return int(value)
		}
	}
	return 0
}

func firstFloat(fields map[string]json.RawMessage, keys ...string) float64 {
	for _, key := range keys {
		raw, ok := fields[key]
		if !ok {
			continue
		}
		var number json.Number
		if err := json.Unmarshal(raw, &number); err != nil {
			continue
		}
		if value, err := number.Float64(); err == nil {
			return value
		}
	}
	return 0
}

// wavDurationSeconds 从 RIFF/WAVE 头推算音频时长，界面不用解码
// 音频就能显示实时倍率。无法识别的格式返回 0，而不是
// 给出一个猜测值。
func wavDurationSeconds(data []byte) float64 {
	if len(data) < 12 || string(data[0:4]) != "RIFF" || string(data[8:12]) != "WAVE" {
		return 0
	}
	byteRate := 0
	dataBytes := 0
	for offset := 12; offset+8 <= len(data); {
		id := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		body := data[offset+8:]
		if size < 0 || size > len(data) {
			// 错误的 chunk 大小要么越界读缓冲区，要么导致死循环。
			break
		}
		switch id {
		case "fmt ":
			if len(body) >= 12 {
				byteRate = int(binary.LittleEndian.Uint32(body[8:12]))
			}
		case "data":
			if size > 0 {
				dataBytes = size
				if dataBytes > len(body) {
					dataBytes = len(body)
				}
			}
		}
		offset += 8 + size + size%2
	}
	if byteRate <= 0 || dataBytes <= 0 {
		return 0
	}
	return float64(dataBytes) / float64(byteRate)
}

// sanitizeEndpoint 去掉凭据、查询串和片段，调用记录因此
// 永远不会存下 API key 或带签名的 URL。
func sanitizeEndpoint(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return ""
	}
	parsed.User = nil
	parsed.RawQuery = ""
	parsed.Fragment = ""
	return parsed.String()
}

func truncate(text string, limit int) string {
	trimmed := strings.TrimSpace(text)
	if len(trimmed) <= limit {
		return trimmed
	}
	// 按字节偏移截断可能切断一个 rune；ToValidUTF8 会修复尾部。
	return strings.ToValidUTF8(trimmed[:limit], "") + "…"
}
