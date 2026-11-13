package desktop

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/huangypx/shiyu/backend"
)

// startSession 打开原生麦克风并把采集到的 PCM 直接追加到后端
// 录音会话。窗口此时只是视图，销毁它们不会中断采集。
func (c *Controller) startSession(token uint64) {
	_, _ = c.app.CancelRecording()
	if _, err := c.app.StartRecording(
		"recording.wav",
		"audio/wav",
		"",
		"",
		captureSampleRate,
	); err != nil {
		c.failSession(token, "无法开始录音")
		return
	}

	capture, err := startNativeCapture(
		func(pcm []byte) {
			if c.tokenActive(token) {
				_ = c.app.AppendRecordingPCM(pcm)
			}
		},
		func(level float64) {
			if c.tokenActive(token) {
				c.PublishMicLevel(level)
			}
		},
		func() { c.handleCaptureStopped(token) },
	)
	if err != nil {
		_, _ = c.app.CancelRecording()
		c.failSession(token, "无法使用麦克风："+err.Error())
		return
	}

	c.sessionMu.Lock()
	if !c.tokenActive(token) {
		c.sessionMu.Unlock()
		capture.Stop()
		_, _ = c.app.CancelRecording()
		return
	}
	c.capture = capture
	c.sessionMu.Unlock()

	c.publishSessionState(SessionState{Status: "recording", Host: ModeOverlay})
}

// stopSession 关闭麦克风，把已采集的 PCM 收尾成 WAV，然后依次走
// 转写与整理。整个流水线在 Go 内，跟窗口生命周期无关。
func (c *Controller) stopSession(token uint64) {
	c.sessionMu.Lock()
	if !c.tokenActive(token) {
		c.sessionMu.Unlock()
		return
	}
	capture := c.capture
	c.capture = nil
	c.mu.RLock()
	transcript := c.session.Transcript
	c.mu.RUnlock()
	c.sessionMu.Unlock()

	c.publishSessionState(SessionState{
		Status:         "processing",
		Stage:          "transcribe",
		Transcript:     transcript,
		StageStartedAt: time.Now().UnixMilli(),
	})
	if capture != nil {
		capture.Stop()
	}
	if !c.tokenActive(token) {
		return
	}

	wav, err := c.app.FinalizeRecordingWAV()
	if err != nil {
		c.failSession(token, "录音为空")
		return
	}
	result, err := c.app.TranscribeAudio(backend.AudioRequest{
		Data:     base64.StdEncoding.EncodeToString(wav),
		Filename: "recording.wav",
		MimeType: "audio/wav",
	})
	if err != nil {
		if c.tokenActive(token) {
			c.failSession(token, "转写失败："+err.Error())
		}
		return
	}
	if !c.tokenActive(token) {
		return
	}

	metrics := SessionMetrics{ASR: &result.Call}
	text := strings.TrimSpace(result.Text)
	c.publishSessionState(SessionState{
		Status:         "processing",
		Stage:          "organize",
		Transcript:     text,
		Metrics:        metrics,
		StageStartedAt: time.Now().UnixMilli(),
	})

	polished, polishErr := c.app.PolishText(backend.PolishRequestDTO{Text: text})
	if !c.tokenActive(token) {
		return
	}
	if polishErr != nil {
		// 整理失败仍保留原始转写：结果会进入剪贴板，但和旧行为一样
		// 不写历史，避免把半成品当成一次完整整理。
		c.notify("整理失败："+polishErr.Error(), "error")
		organized := ""
		if c.app.GetDesktopConfig().ShowResultPreview {
			organized = text
		}
		c.publishSessionState(SessionState{
			Status:     "idle",
			Transcript: text,
			Organized:  organized,
			Metrics:    metrics,
		})
		c.deliverResult(text)
		return
	}

	metrics.LLM = &polished.Call
	organized := ""
	if c.app.GetDesktopConfig().ShowResultPreview {
		organized = polished.Text
	}
	// 先落库再发 idle：主窗口收到状态后会立刻刷新历史，顺序反了
	// 就会少一条刚完成的记录。
	c.saveHistory(text, polished.Text, metrics.ASR, &polished.Call)
	c.publishSessionState(SessionState{
		Status:     "idle",
		Transcript: text,
		Organized:  organized,
		Metrics:    metrics,
	})
	c.deliverResult(polished.Text)
}

func (c *Controller) cancelSession(_ uint64) {
	c.sessionMu.Lock()
	capture := c.capture
	c.capture = nil
	c.sessionMu.Unlock()
	if capture != nil {
		capture.Stop()
	}
	_ = c.app.CancelTranscription()
	_, _ = c.app.CancelRecording()

	c.publishSessionState(SessionState{Status: "idle", Host: ModeOverlay})
	c.notify("已取消这段转写", "success")
}

func (c *Controller) failSession(token uint64, message string) {
	if !c.tokenActive(token) {
		return
	}
	if c.app != nil {
		_, _ = c.app.CancelRecording()
	}
	c.publishSessionState(SessionState{Status: "idle", Host: ModeOverlay})
	c.notify(message, "error")
}

func (c *Controller) handleCaptureStopped(token uint64) {
	if !c.tokenActive(token) {
		return
	}
	c.notify("麦克风已断开", "error")
	go c.stopSession(token)
}

func (c *Controller) tokenActive(token uint64) bool {
	return c.sessionToken.Load() == token
}

// handleASRPartial 把服务商的累计增量文本写进唯一会话状态。
func (c *Controller) handleASRPartial(data any) {
	text := ""
	switch value := data.(type) {
	case backend.PartialText:
		text = value.Text
	case *backend.PartialText:
		if value != nil {
			text = value.Text
		}
	case map[string]any:
		if raw, ok := value["text"].(string); ok {
			text = raw
		}
	case map[string]string:
		text = value["text"]
	}
	if text == "" {
		return
	}

	c.mu.Lock()
	if c.session.Status != "processing" || c.session.Stage != "transcribe" {
		c.mu.Unlock()
		return
	}
	c.session.Transcript = text
	c.session.Revision++
	state := c.session
	c.mu.Unlock()
	c.emitSessionState(state)
}

// OrganizeSession 让 Go 重新整理当前转写，供主窗口的「重新整理」使用。
func (c *Controller) OrganizeSession() error {
	if err := c.ensureRuntime(); err != nil {
		return err
	}
	c.sessionMu.Lock()
	c.mu.RLock()
	status := c.session.Status
	transcript := c.session.Transcript
	metrics := c.session.Metrics
	c.mu.RUnlock()
	if status != "idle" || strings.TrimSpace(transcript) == "" {
		c.sessionMu.Unlock()
		return nil
	}
	token := c.sessionToken.Add(1)
	c.sessionMu.Unlock()

	go c.runOrganize(token, transcript, metrics)
	return nil
}

func (c *Controller) runOrganize(token uint64, transcript string, metrics SessionMetrics) {
	c.publishSessionState(SessionState{
		Status:         "processing",
		Stage:          "organize",
		Transcript:     transcript,
		Metrics:        metrics,
		StageStartedAt: time.Now().UnixMilli(),
	})
	polished, err := c.app.PolishText(backend.PolishRequestDTO{Text: transcript})
	if !c.tokenActive(token) {
		return
	}
	if err != nil {
		c.notify("整理失败："+err.Error(), "error")
		c.publishSessionState(SessionState{
			Status:     "idle",
			Transcript: transcript,
			Metrics:    metrics,
		})
		return
	}

	metrics.LLM = &polished.Call
	organized := ""
	if c.app.GetDesktopConfig().ShowResultPreview {
		organized = polished.Text
	}
	c.saveHistory(transcript, polished.Text, metrics.ASR, &polished.Call)
	c.publishSessionState(SessionState{
		Status:     "idle",
		Transcript: transcript,
		Organized:  organized,
		Metrics:    metrics,
	})
	c.deliverResult(polished.Text)
}

// saveHistory 把一次完整结果写成历史。重新整理会命中同一个 ID，
// 因此只更新原记录，不会多出一条。
func (c *Controller) saveHistory(
	transcript, result string,
	asr, llm *backend.CallRecord,
) {
	if c.app == nil {
		return
	}
	c.mu.Lock()
	id := c.historyID
	if id == "" {
		id = fmt.Sprintf("%d", time.Now().UnixNano())
		c.historyID = id
	}
	started := c.sessionStartedAt
	c.mu.Unlock()
	if started.IsZero() {
		started = time.Now()
	}

	entry := backend.HistoryEntry{
		ID:         id,
		CreatedAt:  started,
		Transcript: transcript,
		Organized:  result,
		Calls:      make([]backend.CallRecord, 0, 2),
	}
	if asr != nil {
		entry.ASRModelID = asr.ModelID
		entry.DurationMS += asr.DurationMS
		entry.Calls = append(entry.Calls, *asr)
	}
	if llm != nil {
		entry.LLMModelID = llm.ModelID
		entry.PresetName = llm.Preset
		entry.DurationMS += llm.DurationMS
		entry.Calls = append(entry.Calls, *llm)
	}
	_, _ = c.app.SaveHistory(entry)
}

func (c *Controller) deliverResult(result string) {
	if strings.TrimSpace(result) == "" {
		return
	}
	if !c.app.GetDesktopConfig().AutoPaste {
		c.notify("已完成转写和整理", "success")
		return
	}
	if err := c.PasteText(result); err != nil {
		c.notify("已整理，自动粘贴失败，结果仍在剪贴板中", "error")
		return
	}
	c.notify("已整理并粘贴到当前光标", "success")
}
