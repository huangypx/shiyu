package desktop

import (
	"encoding/binary"
	"math"
	"sync"
	"time"

	"github.com/gen2brain/malgo"
)

const (
	// 原生采集统一按 16 kHz 单声道 S16 打开；miniaudio 会在设备
	// 不支持时做内部转换，后端拿到的就是可直接拼 WAV 的 PCM。
	captureSampleRate = 16000
	// 电平广播节流与前端原来的 ~20Hz 保持一致。
	captureLevelInterval = 50 * time.Millisecond
)

// nativeCapture 封装一次麦克风采集。数据回调在音频线程上执行，
// 只做追加和电平计算；停止时由调用方负责把已采集的数据收尾。
type nativeCapture struct {
	ctx    *malgo.AllocatedContext
	device *malgo.Device

	onData  func([]byte)
	onLevel func(float64)
	onStop  func()

	mu        sync.Mutex
	stopping  bool
	smoothed  float64
	lastLevel time.Time
}

// startNativeCapture 用默认输入设备打开 16 kHz 单声道采集。
// backend 由 malgo/miniaudio 选择：macOS CoreAudio、Windows WASAPI、
// Linux ALSA/PulseAudio。
func startNativeCapture(
	onData func([]byte),
	onLevel func(float64),
	onStop func(),
) (*nativeCapture, error) {
	ctx, err := malgo.InitContext(nil, malgo.ContextConfig{}, nil)
	if err != nil {
		return nil, err
	}
	config := malgo.DefaultDeviceConfig(malgo.Capture)
	config.Capture.Format = malgo.FormatS16
	config.Capture.Channels = 1
	config.SampleRate = captureSampleRate
	config.PeriodSizeInMilliseconds = 20
	// ALSA 默认的 mmap 模式在部分声卡上会阻塞采集，Pulse 路径也
	// 更稳定；这是 miniaudio 官方示例推荐的设置。
	config.Alsa.NoMMap = 1

	capture := &nativeCapture{ctx: ctx, onData: onData, onLevel: onLevel, onStop: onStop}
	device, err := malgo.InitDevice(ctx.Context, config, malgo.DeviceCallbacks{
		Data: func(_, input []byte, _ uint32) {
			if len(input) == 0 {
				return
			}
			capture.handleData(input)
		},
		Stop: capture.handleStop,
	})
	if err != nil {
		ctx.Free()
		return nil, err
	}
	capture.device = device
	if err := device.Start(); err != nil {
		device.Uninit()
		ctx.Free()
		return nil, err
	}
	return capture, nil
}

func (c *nativeCapture) handleData(pcm []byte) {
	c.mu.Lock()
	stopping := c.stopping
	c.mu.Unlock()
	if stopping {
		return
	}
	if c.onData != nil {
		c.onData(pcm)
	}
	c.publishLevel(pcm)
}

func (c *nativeCapture) publishLevel(pcm []byte) {
	target := captureLevel(pcm)

	c.mu.Lock()
	// 起音快、回落慢，球体和波形不会在音节之间抖成锯齿。
	factor := 0.18
	if target > c.smoothed {
		factor = 0.55
	}
	c.smoothed += (target - c.smoothed) * factor
	if c.smoothed < 0.001 {
		c.smoothed = 0
	}
	now := time.Now()
	if !c.lastLevel.IsZero() && now.Sub(c.lastLevel) < captureLevelInterval {
		c.mu.Unlock()
		return
	}
	c.lastLevel = now
	level := c.smoothed
	c.mu.Unlock()

	if c.onLevel != nil {
		c.onLevel(level)
	}
}

func (c *nativeCapture) handleStop() {
	c.mu.Lock()
	stopping := c.stopping
	c.mu.Unlock()
	if stopping || c.onStop == nil {
		return
	}
	c.onStop()
}

// Stop 关闭设备并释放上下文。重复调用是安全的。
func (c *nativeCapture) Stop() {
	if c == nil {
		return
	}
	c.mu.Lock()
	if c.stopping {
		c.mu.Unlock()
		return
	}
	c.stopping = true
	c.mu.Unlock()

	if c.device != nil {
		_ = c.device.Stop()
		c.device.Uninit()
		c.device = nil
	}
	if c.ctx != nil {
		c.ctx.Free()
		c.ctx = nil
	}
}

// captureLevel 把 S16 LE 的 RMS 换算成与界面一致的 0–1 电平。
func captureLevel(pcm []byte) float64 {
	frames := len(pcm) / 2
	if frames == 0 {
		return 0
	}
	var sum float64
	for i := 0; i < frames; i++ {
		sample := float64(int16(binary.LittleEndian.Uint16(pcm[i*2:]))) / 32768
		sum += sample * sample
	}
	rms := math.Sqrt(sum / float64(frames))
	if rms <= 0 {
		return 0
	}
	db := 20 * math.Log10(rms)
	const floor = -50.0
	if db <= floor {
		return 0
	}
	normalized := (db - floor) / -floor
	if normalized > 1 {
		normalized = 1
	}
	return math.Pow(normalized, 0.8)
}
