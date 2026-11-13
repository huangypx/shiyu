package desktop

import (
	"encoding/binary"
	"math"
	"testing"

	"github.com/huangypx/shiyu/backend"
)

func TestCaptureLevelSilenceIsZero(t *testing.T) {
	if got := captureLevel(nil); got != 0 {
		t.Fatalf("nil level = %v", got)
	}
	if got := captureLevel(make([]byte, 3200)); got != 0 {
		t.Fatalf("silence level = %v", got)
	}
}

func TestCaptureLevelTracksSignal(t *testing.T) {
	const frames = 1600
	pcm := make([]byte, frames*2)
	for i := 0; i < frames; i++ {
		// 0.5 满幅的正弦波，RMS 约 -9dB，应该落在中高区间。
		value := int16(16000 * math.Sin(2*math.Pi*440*float64(i)/captureSampleRate))
		binary.LittleEndian.PutUint16(pcm[i*2:], uint16(value))
	}
	level := captureLevel(pcm)
	if level <= 0.4 || level > 1 {
		t.Fatalf("signal level = %v, want a visible mid/high level", level)
	}
}

func TestHandleASRPartialOnlyUpdatesTranscribingSession(t *testing.T) {
	controller := NewController(nil, nil)
	controller.publishSessionState(SessionState{Status: "processing", Stage: "transcribe"})
	controller.handleASRPartial(backend.PartialText{Text: "你好"})
	if got := controller.GetSession().Transcript; got != "你好" {
		t.Fatalf("transcript = %q", got)
	}

	controller.publishSessionState(SessionState{Status: "idle"})
	controller.handleASRPartial(backend.PartialText{Text: "迟到"})
	if got := controller.GetSession().Transcript; got != "" {
		t.Fatalf("idle session accepted partial %q", got)
	}
}
