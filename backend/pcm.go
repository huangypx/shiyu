package backend

import (
	"encoding/binary"
	"math"
)

// recordingWAVSampleRate 是 ASR 端点统一接受的采样率。前端按
// AudioContext 的原生采样率上传 Int16 PCM，收尾时在这里重采样，
// 避免在浏览器里维护跨分片的流式重采样状态。
const recordingWAVSampleRate = 16000

// encodeRecordingWAV 把 Int16 LE 的单声道 PCM 重采样到 16 kHz，
// 再补上 44 字节 RIFF 头。数据为空时返回 nil，调用方据此报错。
func encodeRecordingWAV(data []byte, sampleRate int) []byte {
	if len(data) < 2 {
		return nil
	}
	// 分片按样本边界上传，但异常中断时可能留下半个样本。
	if len(data)%2 != 0 {
		data = data[:len(data)-1]
	}
	samples := make([]int16, len(data)/2)
	for i := range samples {
		samples[i] = int16(binary.LittleEndian.Uint16(data[i*2:]))
	}
	if sampleRate <= 0 {
		sampleRate = recordingWAVSampleRate
	}
	if sampleRate != recordingWAVSampleRate {
		samples = resamplePCM16(samples, sampleRate, recordingWAVSampleRate)
	}
	return wavFromPCM16(samples)
}

// resamplePCM16 只处理单声道 16 位 PCM。降采样取窗口平均，
// 升采样按最近邻复制：录音设备通常高于 16 kHz，升采样只是兜底。
func resamplePCM16(input []int16, from, to int) []int16 {
	if from == to || len(input) == 0 || from <= 0 || to <= 0 {
		return input
	}
	ratio := float64(from) / float64(to)
	length := int(math.Round(float64(len(input)) / ratio))
	if length < 1 {
		length = 1
	}
	output := make([]int16, length)
	for i := 0; i < length; i++ {
		if from < to {
			source := int(float64(i) * ratio)
			if source >= len(input) {
				source = len(input) - 1
			}
			output[i] = input[source]
			continue
		}
		start := int(float64(i) * ratio)
		end := int(float64(i+1) * ratio)
		if start >= len(input) {
			start = len(input) - 1
		}
		if end > len(input) {
			end = len(input)
		}
		if end <= start {
			output[i] = input[start]
			continue
		}
		sum := 0
		for j := start; j < end; j++ {
			sum += int(input[j])
		}
		output[i] = int16(sum / (end - start))
	}
	return output
}

func wavFromPCM16(samples []int16) []byte {
	dataSize := len(samples) * 2
	buffer := make([]byte, 44+dataSize)
	copy(buffer[0:4], "RIFF")
	binary.LittleEndian.PutUint32(buffer[4:8], uint32(36+dataSize))
	copy(buffer[8:12], "WAVE")
	copy(buffer[12:16], "fmt ")
	binary.LittleEndian.PutUint32(buffer[16:20], 16)
	binary.LittleEndian.PutUint16(buffer[20:22], 1)
	binary.LittleEndian.PutUint16(buffer[22:24], 1)
	binary.LittleEndian.PutUint32(buffer[24:28], recordingWAVSampleRate)
	binary.LittleEndian.PutUint32(buffer[28:32], recordingWAVSampleRate*2)
	binary.LittleEndian.PutUint16(buffer[32:34], 2)
	binary.LittleEndian.PutUint16(buffer[34:36], 16)
	copy(buffer[36:40], "data")
	binary.LittleEndian.PutUint32(buffer[40:44], uint32(dataSize))
	for i, sample := range samples {
		binary.LittleEndian.PutUint16(buffer[44+i*2:], uint16(sample))
	}
	return buffer
}
