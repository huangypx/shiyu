package backend

import (
	"testing"
	"time"
)

func newTestHistory(t *testing.T) *HistoryStore {
	t.Helper()
	store, err := OpenHistoryStore(t.TempDir() + "/history.db")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func sampleEntry(id string, createdAt time.Time) HistoryEntry {
	return HistoryEntry{
		ID:         id,
		CreatedAt:  createdAt,
		Transcript: "raw " + id,
		Organized:  "## 标题 " + id,
		PresetName: "会议纪要",
		Calls: []CallRecord{{
			ID:    "call-" + id,
			Kind:  CallKindLLM,
			Model: "gpt-4o-mini",
			OK:    true,
			Usage: TokenUsage{TotalTokens: 12},
		}},
	}
}

func TestHistoryStoreRoundTrip(t *testing.T) {
	store := newTestHistory(t)
	created := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	saved, err := store.Save(sampleEntry("a", created))
	if err != nil {
		t.Fatal(err)
	}
	// 标题与预览由后端兜底派生，调用方不必自己算。
	if saved.Title != "标题 a" {
		t.Fatalf("derived title = %q", saved.Title)
	}
	if saved.Preview != "raw a" {
		t.Fatalf("derived preview = %q", saved.Preview)
	}

	got, found, err := store.Get("a")
	if err != nil || !found {
		t.Fatalf("get: found=%v err=%v", found, err)
	}
	if !got.CreatedAt.Equal(created) {
		t.Fatalf("created at = %v, want %v", got.CreatedAt, created)
	}
	if len(got.Calls) != 1 || got.Calls[0].Usage.TotalTokens != 12 {
		t.Fatalf("calls = %+v", got.Calls)
	}
	if _, found, err := store.Get("missing"); err != nil || found {
		t.Fatalf("missing entry: found=%v err=%v", found, err)
	}
}

func TestHistoryStoreListOrdersNewestFirst(t *testing.T) {
	store := newTestHistory(t)
	base := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	for i, id := range []string{"a", "b", "c"} {
		if _, err := store.Save(sampleEntry(id, base.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	entries, err := store.List(2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 2 || entries[0].ID != "c" || entries[1].ID != "b" {
		t.Fatalf("list = %+v", entries)
	}
	// 每一条都应带回自己的调用明细。
	if len(entries[0].Calls) != 1 {
		t.Fatalf("calls were not attached: %+v", entries[0])
	}
	page, err := store.List(2, 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page) != 1 || page[0].ID != "a" {
		t.Fatalf("second page = %+v", page)
	}
	// limit 超出上限时按上限截断，不能一次拉走整库。
	all, err := store.List(10000, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 3 {
		t.Fatalf("limited list length = %d", len(all))
	}
}

func TestHistoryStoreSaveReplacesCalls(t *testing.T) {
	store := newTestHistory(t)
	created := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
	entry := sampleEntry("a", created)
	entry.Calls = append(entry.Calls, CallRecord{ID: "call-asr", Kind: CallKindASR, OK: true})
	if _, err := store.Save(entry); err != nil {
		t.Fatal(err)
	}
	// 同一条记录再次保存（例如重新整理）不能留下重复明细。
	entry.Calls = entry.Calls[:1]
	entry.Organized = "## 新标题\n内容"
	if _, err := store.Save(entry); err != nil {
		t.Fatal(err)
	}
	got, _, err := store.Get("a")
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Calls) != 1 {
		t.Fatalf("calls = %d, want the replaced single call", len(got.Calls))
	}
	if got.Organized != "## 新标题\n内容" {
		t.Fatalf("organized = %q", got.Organized)
	}
}

func TestOlderHistoryAfterDeletedCursorAtSameTime(t *testing.T) {
	store := newTestHistory(t)
	app := &App{history: store}
	created := time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)
	for _, id := range []string{"a", "b", "c"} {
		if _, err := store.Save(sampleEntry(id, created)); err != nil {
			t.Fatal(err)
		}
	}
	page, err := app.ListHistory(2, 0)
	if err != nil || len(page) != 2 || page[1].ID != "b" {
		t.Fatalf("first page = %+v, err = %v", page, err)
	}
	cursor := page[1]
	if err := store.Delete(cursor.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(sampleEntry("d", created.Add(time.Minute))); err != nil {
		t.Fatal(err)
	}
	older, err := app.ListOlderHistory(2, cursor.CreatedAt.Format(time.RFC3339Nano), cursor.ID)
	if err != nil || len(older) != 1 || older[0].Transcript != "raw a" {
		t.Fatalf("older page = %+v, err = %v", older, err)
	}
}

func TestHistoryStoreDeleteClearAndCount(t *testing.T) {
	store := newTestHistory(t)
	base := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
	for i, id := range []string{"a", "b"} {
		if _, err := store.Save(sampleEntry(id, base.Add(time.Duration(i)*time.Minute))); err != nil {
			t.Fatal(err)
		}
	}
	if err := store.Delete("a"); err != nil {
		t.Fatal(err)
	}
	count, err := store.Count()
	if err != nil || count != 1 {
		t.Fatalf("count = %d err=%v", count, err)
	}
	// 级联删除：记录没了，明细也不能留下。
	var calls int
	if err := store.db.QueryRow("SELECT COUNT(*) FROM record_calls WHERE record_id = ?", "a").Scan(&calls); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Fatalf("calls for deleted record = %d, want 0", calls)
	}

	if err := store.Clear(); err != nil {
		t.Fatal(err)
	}
	count, err = store.Count()
	if err != nil || count != 0 {
		t.Fatalf("count after clear = %d err=%v", count, err)
	}
}

func TestHistoryStorePrune(t *testing.T) {
	store := newTestHistory(t)
	old := time.Now().AddDate(0, 0, -40)
	recent := time.Now().AddDate(0, 0, -1)
	if _, err := store.Save(sampleEntry("old", old)); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Save(sampleEntry("recent", recent)); err != nil {
		t.Fatal(err)
	}
	removed, err := store.Prune(time.Now().AddDate(0, 0, -30))
	if err != nil {
		t.Fatal(err)
	}
	if removed != 1 {
		t.Fatalf("pruned = %d, want 1", removed)
	}
	entries, err := store.List(10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 1 || entries[0].ID != "recent" {
		t.Fatalf("entries after prune = %+v", entries)
	}
}

func TestHistoryStoreImportLegacyIsIdempotent(t *testing.T) {
	store := newTestHistory(t)
	base := time.Date(2026, 5, 1, 0, 0, 0, 0, time.UTC)
	entries := []HistoryEntry{sampleEntry("a", base), sampleEntry("b", base.Add(time.Minute))}
	imported, err := store.ImportLegacy(entries)
	if err != nil || imported != 2 {
		t.Fatalf("imported = %d err=%v", imported, err)
	}
	// 重复导入不能产生重复数据——迁移最怕中途失败后重跑。
	imported, err = store.ImportLegacy(entries)
	if err != nil || imported != 0 {
		t.Fatalf("second import = %d err=%v", imported, err)
	}
	count, err := store.Count()
	if err != nil || count != 2 {
		t.Fatalf("count = %d err=%v", count, err)
	}
}

func TestHistoryStoreCreatesPrivateDatabase(t *testing.T) {
	dir := t.TempDir()
	store, err := OpenHistoryStore(dir + "/history.db")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if got := store.Path(); got != dir+"/history.db" {
		t.Fatalf("path = %q", got)
	}
	// WAL 模式下写入后应能读回，且不要立刻因为未关闭连接报错。
	if _, err := store.Save(sampleEntry("a", time.Now())); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Count(); err != nil {
		t.Fatal(err)
	}
}

func TestAppHistoryAPIRequiresStore(t *testing.T) {
	app, err := NewAppWithConfig(DefaultConfig(), NewConfigStore(t.TempDir()+"/config.json"))
	if err != nil {
		t.Fatal(err)
	}
	// 没有挂数据库时所有历史接口都返回明确的错误，而不是 panic。
	if _, err := app.ListHistory(10, 0); err == nil {
		t.Fatal("ListHistory should fail without a store")
	}
	if _, err := app.SaveHistory(sampleEntry("a", time.Now())); err == nil {
		t.Fatal("SaveHistory should fail without a store")
	}
	if app.HistoryPath() != "" {
		t.Fatalf("history path = %q, want empty", app.HistoryPath())
	}
	if removed, err := app.PruneHistory(30); err != nil || removed != 0 {
		t.Fatalf("prune without store = %d err=%v", removed, err)
	}

	if err := app.AttachHistory(t.TempDir() + "/history.db"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := app.history.Close(); err != nil {
			t.Error(err)
		}
	})
	if _, err := app.SaveHistory(sampleEntry("a", time.Now())); err != nil {
		t.Fatal(err)
	}
	entries, err := app.ListHistory(10, 0)
	if err != nil || len(entries) != 1 {
		t.Fatalf("list = %+v err=%v", entries, err)
	}
	if count, err := app.HistoryCount(); err != nil || count != 1 {
		t.Fatalf("count = %d err=%v", count, err)
	}
}
