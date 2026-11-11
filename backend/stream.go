package backend

import (
	"strings"
	"time"
)

// EventASRPartial 是转写增量文本的事件名，界面订阅它实现逐字上屏。
const EventASRPartial = "asr:partial"

// partialInterval 是推送增量文本的最小间隔。识别模型逐 token 返回，
// 不节流会让每个 token 都穿一次 JSON 桥；80ms 在这个量级下既看不出
// 停顿，也不会让界面每秒重绘几十次。
const partialInterval = 80 * time.Millisecond

// Emitter 把后端发生的事推给界面。为 nil 时所有推送静默，浏览器
// 预览与单元测试因此不需要 Wails 运行时。
type Emitter func(name string, data any)

// PartialText 是 asr:partial 的载荷。它携带累计文本而不是增量，
// 因此丢一帧只会让界面晚一拍，不会拼错。
type PartialText struct {
	Text string `json:"text"`
}

// partialPump 把服务商的增量回调节流成界面事件。
type partialPump struct {
	emit     Emitter
	interval time.Duration
	// now 只在测试里替换，用来验证节流边界。
	now      func() time.Time
	text     string
	lastSent string
	lastAt   time.Time
}

func newPartialPump(emit Emitter) *partialPump {
	return &partialPump{emit: emit, interval: partialInterval, now: time.Now}
}

// push 接收累计文本，按间隔节流后推给界面。
func (p *partialPump) push(text string) {
	p.text = text
	if p.emit == nil || text == p.lastSent {
		return
	}
	if !p.lastAt.IsZero() && p.now().Sub(p.lastAt) < p.interval {
		return
	}
	p.send()
}

// done 在识别结束时补发最后一帧，保证界面停在最终文本上。
func (p *partialPump) done() {
	if p.emit == nil || p.text == p.lastSent {
		return
	}
	p.send()
}

func (p *partialPump) send() {
	if strings.TrimSpace(p.text) == "" {
		return
	}
	p.emit(EventASRPartial, PartialText{Text: p.text})
	p.lastSent = p.text
	p.lastAt = p.now()
}
