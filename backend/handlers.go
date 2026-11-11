package backend

import (
	"encoding/base64"
	"errors"
	"strings"
	"time"
)

// AudioRequest 由前端发送。Data 用 base64 编码，因为 Wails 各版本
// 对 []byte 的 base64 序列化行为并不一致。
type AudioRequest struct {
	Data     string `json:"data"`
	Filename string `json:"filename,omitempty"`
	MimeType string `json:"mimeType,omitempty"`
	Language string `json:"language,omitempty"`
	Prompt   string `json:"prompt,omitempty"`
	// PresetID 让整段流水线在与界面相同的预设下整理。
	PresetID string `json:"presetId,omitempty"`
	// ModelID 指定这次转写用哪个 ASR 模型；为空时用当前生效模型。
	ModelID string `json:"modelId,omitempty"`
}

func (r AudioRequest) bytes() ([]byte, error) {
	if strings.TrimSpace(r.Data) == "" {
		return nil, errors.New("audio data is empty")
	}
	encoded := strings.TrimSpace(r.Data)
	// 浏览器 FileReader 通常返回 data URL（data:audio/webm;base64,...）。
	if comma := strings.IndexByte(encoded, ','); strings.HasPrefix(encoded, "data:") && comma >= 0 {
		encoded = encoded[comma+1:]
	}
	b, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		// 也接受省略填充的裸 base64，方便这类客户端。
		b, err = base64.RawStdEncoding.DecodeString(encoded)
	}
	if err != nil {
		return nil, errors.New("audio data is not valid base64")
	}
	if len(b) == 0 {
		return nil, errors.New("audio data is empty")
	}
	return b, nil
}

type PolishRequestDTO struct {
	Text         string `json:"text"`
	Instructions string `json:"instructions,omitempty"`
	Language     string `json:"language,omitempty"`
	// PresetID 指定这次整理用哪套预设；为空或已失效时由后端
	// 回落到当前生效预设。
	PresetID string `json:"presetId,omitempty"`
}

// ProcessResult 是 ASR/整理流水线返回的可序列化结果。
type ProcessResult struct {
	ID           string       `json:"id"`
	Transcript   string       `json:"transcript"`
	PolishedText string       `json:"polishedText"`
	StartedAt    time.Time    `json:"startedAt"`
	FinishedAt   time.Time    `json:"finishedAt"`
	DurationMS   int64        `json:"durationMs"`
	Calls        []CallRecord `json:"calls,omitempty"`
	Error        string       `json:"error,omitempty"`
}
