package backend

import (
	"errors"
	"strings"
	"time"
)

// 这一组方法把历史记录和配置暴露给 Wails。历史页、侧栏的计数、
// 启动时的保留期清理都从这里进来，界面因此不需要知道 SQLite 的存在。

// HistoryEntryDTO 就是 HistoryEntry 本身；保留这个名字是为了让
// 绑定生成结果里的类型名与前端一致。
type HistoryEntryDTO = HistoryEntry

// SaveHistory 写入一条历史记录并返回落库后的完整内容。
// 没有挂上数据库时返回空条目：浏览器预览与部分测试根本没有
// 数据库，调用方据此决定是否退回 localStorage。
func (a *App) SaveHistory(entry HistoryEntry) (HistoryEntry, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return HistoryEntry{}, errors.New("history store is not configured")
	}
	return store.Save(entry)
}

// ListHistory 返回最近的历史记录，新记录在前。
func (a *App) ListHistory(limit, offset int) ([]HistoryEntry, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return nil, errors.New("history store is not configured")
	}
	return store.List(limit, offset)
}

// ListOlderHistory 支持在主窗口继续查看更早的文本，时间和 ID 来自上一页末项。
func (a *App) ListOlderHistory(limit int, createdAt, id string) ([]HistoryEntry, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return nil, errors.New("history store is not configured")
	}
	return store.list(limit, 0, createdAt, id)
}

// GetHistory 读取单条历史；已删除时返回 false。
func (a *App) GetHistory(id string) (HistoryEntry, bool, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return HistoryEntry{}, false, errors.New("history store is not configured")
	}
	return store.Get(strings.TrimSpace(id))
}

// DeleteHistory 删除单条历史。
func (a *App) DeleteHistory(id string) error {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return errors.New("history store is not configured")
	}
	return store.Delete(strings.TrimSpace(id))
}

// ClearHistory 清空历史。它只删记录，不动配置与调用日志。
func (a *App) ClearHistory() error {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return errors.New("history store is not configured")
	}
	return store.Clear()
}

// HistoryCount 返回历史条数，侧栏徽标用它。
func (a *App) HistoryCount() (int, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return 0, errors.New("history store is not configured")
	}
	return store.Count()
}

// HistoryPath 暴露数据库位置，便于诊断与「数据在哪里」的提示。
func (a *App) HistoryPath() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.history == nil {
		return ""
	}
	return a.history.Path()
}

// ImportHistory 把旧版 localStorage 里的记录一次性导入。
// 返回真正写入的条数：重复执行时全部命中已有 ID，结果为 0。
func (a *App) ImportHistory(entries []HistoryEntry) (int, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil {
		return 0, errors.New("history store is not configured")
	}
	return store.ImportLegacy(entries)
}

// PruneHistory 删除早于保留期的记录。days <= 0 表示永久保留，
// 直接返回 0 条。启动时调用一次即可。
func (a *App) PruneHistory(days int) (int64, error) {
	a.mu.RLock()
	store := a.history
	a.mu.RUnlock()
	if store == nil || days <= 0 {
		return 0, nil
	}
	return store.Prune(time.Now().AddDate(0, 0, -days))
}
