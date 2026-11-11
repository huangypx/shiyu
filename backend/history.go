package backend

import "strings"

// 调用日志只保存在内存里。它记录的是「这次运行发生了什么」，
// 不是用户资产：失败请求的细节对排查很有用，但长期留存既占空间
// 也没有明确的清理策略。历史记录另有一套 SQLite 实现。

// appendCall 维护有上限的服务商调用日志，供调用详情视图使用。
// 没有 ID 的记录从未到达服务商，会被跳过。
func (a *App) appendCall(record CallRecord) {
	if record.ID == "" {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, record)
	limit := a.callLimit
	if limit < 1 {
		limit = defaultCallLimit
	}
	if len(a.calls) > limit {
		a.calls = append([]CallRecord(nil), a.calls[len(a.calls)-limit:]...)
	}
}

// RecentCalls 按最新在前的顺序返回调用日志，界面就是用
// 这个顺序渲染的。
func (a *App) RecentCalls() []CallRecord {
	a.mu.RLock()
	defer a.mu.RUnlock()
	records := make([]CallRecord, 0, len(a.calls))
	for i := len(a.calls) - 1; i >= 0; i-- {
		records = append(records, a.calls[i])
	}
	return records
}

// ClearCalls 清空调用日志，但不碰历史记录。
func (a *App) ClearCalls() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = nil
}

// appendCallRecord 把非空记录收集到 ProcessResult 上。
func appendCallRecord(records []CallRecord, record CallRecord) []CallRecord {
	if record.ID == "" {
		return records
	}
	return append(records, record)
}

// languageCode 把界面上的语言名称映射成服务商接受的代码。
// 认不出的值原样透传：用户可能填的是服务商专有标识。
func languageCode(language string) string {
	switch strings.ToLower(strings.TrimSpace(language)) {
	case "中文（普通话）", "中文", "普通话", "chinese", "zh-cn":
		return "zh"
	case "english", "英语", "en-us":
		return "en"
	case "日本語", "日语", "japanese", "ja-jp":
		return "ja"
	case "", "自动识别", "auto", "automatic":
		return ""
	default:
		return strings.TrimSpace(language)
	}
}
