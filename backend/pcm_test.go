package backend

import (
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"
)

func TestEncodeRecordingWAVWritesHeaderAndResamples(t *testing.T) {
	// 48 kHz 静音两帧，降采样后应得到约三分之一个 16 kHz 样本。
	input := make([]byte, 4)
	wav := encodeRecordingWAV(input, 48000)
	if len(wav) < 44 {
		t.Fatalf("wav too short: %d", len(wav))
	}
	if string(wav[0:4]) != "RIFF" || string(wav[8:12]) != "WAVE" {
		t.Fatalf("missing RIFF/WAVE header")
	}
	if got := binary.LittleEndian.Uint32(wav[24:28]); got != recordingWAVSampleRate {
		t.Fatalf("sample rate = %d, want %d", got, recordingWAVSampleRate)
	}
	if got := binary.LittleEndian.Uint16(wav[22:24]); got != 1 {
		t.Fatalf("channels = %d, want mono", got)
	}
	dataSize := binary.LittleEndian.Uint32(wav[40:44])
	if int(dataSize) != len(wav)-44 {
		t.Fatalf("data size = %d, payload = %d", dataSize, len(wav)-44)
	}
}

func TestEncodeRecordingWAVRejectsEmptyPCM(t *testing.T) {
	if wav := encodeRecordingWAV(nil, 16000); wav != nil {
		t.Fatalf("empty PCM produced %d bytes", len(wav))
	}
	if wav := encodeRecordingWAV([]byte{1}, 16000); wav != nil {
		t.Fatalf("half sample produced %d bytes", len(wav))
	}
}

func TestFinalizeRecordingReturnsDataURLAndClearsSession(t *testing.T) {
	app := &App{}
	if _, err := app.StartRecording("recording.wav", "audio/wav", "", "", 16000); err != nil {
		t.Fatal(err)
	}
	if _, err := app.AppendRecordingChunk(AudioChunk{Data: "AAAAAAA="}); err != nil {
		t.Fatal(err)
	}
	audio, err := app.FinalizeRecording()
	if err != nil {
		t.Fatal(err)
	}
	const prefix = "data:audio/wav;base64,"
	if !strings.HasPrefix(audio.Data, prefix) {
		t.Fatalf("data URL prefix = %q", audio.Data)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(audio.Data, prefix))
	if err != nil {
		t.Fatal(err)
	}
	if len(decoded) != audio.Bytes || len(decoded) < 44 {
		t.Fatalf("decoded = %d bytes, reported %d", len(decoded), audio.Bytes)
	}
	if app.RecordingStatus().Active {
		t.Fatal("recording remained active after finalize")
	}
}
