package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

// 历史记录是用户真正在意的那部分数据，因此单独放进 SQLite，
// 而不是继续塞进 localStorage。localStorage 每次写入都要整段
// 序列化、没有查询能力、配额到顶还会静默失败。

// historySchemaVersion 是数据库结构的版本。schema_migrations
// 表记录已应用的版本，后续加字段时按版本号追加迁移即可。
const historySchemaVersion = 1

// defaultHistoryLimit 是 List 在调用方没给上限时使用的条数。
const defaultHistoryLimit = 100

// maxHistoryLimit 防止界面一次拉走整库数据。
const maxHistoryLimit = 500

// HistoryEntry 是一条历史记录的可序列化形式。字段与前端 Note 对应，
// 但多带上了真正落库需要的元信息。
type HistoryEntry struct {
	ID         string       `json:"id"`
	CreatedAt  time.Time    `json:"createdAt"`
	Title      string       `json:"title"`
	Preview    string       `json:"preview"`
	Transcript string       `json:"transcript"`
	Organized  string       `json:"organized,omitempty"`
	Language   string       `json:"language,omitempty"`
	PresetID   string       `json:"presetId,omitempty"`
	PresetName string       `json:"presetName,omitempty"`
	ASRModelID string       `json:"asrModelId,omitempty"`
	LLMModelID string       `json:"llmModelId,omitempty"`
	DurationMS int64        `json:"durationMs,omitempty"`
	Error      string       `json:"error,omitempty"`
	Calls      []CallRecord `json:"calls,omitempty"`
}

// HistoryStore 封装 SQLite 连接。桌面应用的写入频率很低，
// 因此所有操作串行执行即可，不必上连接池。
type HistoryStore struct {
	path string
	db   *sql.DB
	mu   sync.Mutex
}

// OpenHistoryStore 打开（必要时创建）历史数据库。
func OpenHistoryStore(path string) (*HistoryStore, error) {
	if strings.TrimSpace(path) == "" {
		return nil, errors.New("history path is empty")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, fmt.Errorf("create history directory: %w", err)
	}
	// 先按 0600 建好文件，避免驱动按 umask 建出 0644。
	if err := TouchFile(path); err != nil {
		return nil, err
	}
	dsn := fmt.Sprintf("file:%s?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("open history database: %w", err)
	}
	// 单连接：桌面端并发极低，串行能避免 SQLITE_BUSY，
	// 也让 WAL 的检查点时机可预测。
	db.SetMaxOpenConns(1)
	store := &HistoryStore{path: path, db: db}
	if err := store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *HistoryStore) Path() string { return s.path }

func (s *HistoryStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func (s *HistoryStore) migrate() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	statements := []string{
		`CREATE TABLE IF NOT EXISTS schema_migrations (
			version    INTEGER PRIMARY KEY,
			applied_at TEXT NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS records (
			id           TEXT PRIMARY KEY,
			created_at   TEXT NOT NULL,
			title        TEXT NOT NULL,
			preview      TEXT NOT NULL,
			transcript   TEXT NOT NULL,
			organized    TEXT NOT NULL DEFAULT '',
			language     TEXT NOT NULL DEFAULT '',
			preset_id    TEXT NOT NULL DEFAULT '',
			preset_name  TEXT NOT NULL DEFAULT '',
			asr_model_id TEXT NOT NULL DEFAULT '',
			llm_model_id TEXT NOT NULL DEFAULT '',
			duration_ms  INTEGER NOT NULL DEFAULT 0,
			error        TEXT NOT NULL DEFAULT ''
		)`,
		`CREATE INDEX IF NOT EXISTS idx_records_created_at ON records(created_at DESC)`,
		`CREATE TABLE IF NOT EXISTS record_calls (
			id        TEXT PRIMARY KEY,
			record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
			kind      TEXT NOT NULL,
			payload   TEXT NOT NULL
		)`,
		`CREATE INDEX IF NOT EXISTS idx_record_calls_record ON record_calls(record_id)`,
	}
	for _, statement := range statements {
		if _, err := s.db.Exec(statement); err != nil {
			return fmt.Errorf("initialize history schema: %w", err)
		}
	}
	var applied int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM schema_migrations WHERE version = ?", historySchemaVersion).Scan(&applied); err != nil {
		return fmt.Errorf("read history schema version: %w", err)
	}
	if applied == 0 {
		if _, err := s.db.Exec("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)", historySchemaVersion, time.Now().UTC().Format(time.RFC3339)); err != nil {
			return fmt.Errorf("record history schema version: %w", err)
		}
	}
	return nil
}

// Save 写入一条记录。id 已存在时替换整条内容，调用明细一并重建，
// 这样「重新整理同一条记录」不会留下两份明细。
func (s *HistoryStore) Save(entry HistoryEntry) (HistoryEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if strings.TrimSpace(entry.ID) == "" {
		return HistoryEntry{}, errors.New("history entry is missing an id")
	}
	entry = normalizeHistoryEntry(entry)
	createdAt := entry.CreatedAt.UTC().Format(time.RFC3339Nano)
	tx, err := s.db.Begin()
	if err != nil {
		return HistoryEntry{}, fmt.Errorf("begin history transaction: %w", err)
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO records (
			id, created_at, title, preview, transcript, organized, language,
			preset_id, preset_name, asr_model_id, llm_model_id, duration_ms, error
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			created_at = excluded.created_at,
			title = excluded.title,
			preview = excluded.preview,
			transcript = excluded.transcript,
			organized = excluded.organized,
			language = excluded.language,
			preset_id = excluded.preset_id,
			preset_name = excluded.preset_name,
			asr_model_id = excluded.asr_model_id,
			llm_model_id = excluded.llm_model_id,
			duration_ms = excluded.duration_ms,
			error = excluded.error`,
		entry.ID, createdAt, entry.Title, entry.Preview, entry.Transcript, entry.Organized,
		entry.Language, entry.PresetID, entry.PresetName, entry.ASRModelID, entry.LLMModelID,
		entry.DurationMS, entry.Error); err != nil {
		return HistoryEntry{}, fmt.Errorf("write history record: %w", err)
	}
	if _, err := tx.Exec("DELETE FROM record_calls WHERE record_id = ?", entry.ID); err != nil {
		return HistoryEntry{}, fmt.Errorf("clear history calls: %w", err)
	}
	for i, call := range entry.Calls {
		payload, err := json.Marshal(call)
		if err != nil {
			return HistoryEntry{}, fmt.Errorf("encode history call: %w", err)
		}
		callID := fmt.Sprintf("%s-%d", entry.ID, i)
		if _, err := tx.Exec("INSERT INTO record_calls (id, record_id, kind, payload) VALUES (?, ?, ?, ?)", callID, entry.ID, call.Kind, string(payload)); err != nil {
			return HistoryEntry{}, fmt.Errorf("write history call: %w", err)
		}
	}
	if err := tx.Commit(); err != nil {
		return HistoryEntry{}, fmt.Errorf("commit history transaction: %w", err)
	}
	return entry, nil
}

// List 按时间倒序返回最近的记录。limit 为 0 时使用默认条数，
// 超过上限按上限截断，避免界面一次拉走整库。
func (s *HistoryStore) List(limit, offset int) ([]HistoryEntry, error) {
	return s.list(limit, offset, "", "")
}

func (s *HistoryStore) list(limit, offset int, beforeTime, beforeID string) ([]HistoryEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit <= 0 {
		limit = defaultHistoryLimit
	}
	if limit > maxHistoryLimit {
		limit = maxHistoryLimit
	}
	if offset < 0 {
		offset = 0
	}
	query := `SELECT id, created_at, title, preview, transcript, organized, language,
			preset_id, preset_name, asr_model_id, llm_model_id, duration_ms, error
		FROM records`
	var args []any
	if beforeID != "" {
		// 用上一页末项定位，即使同时录入新文本或删除该项也不会漏掉更早的记录。
		query += " WHERE (created_at, id) < (?, ?)"
		args = append(args, beforeTime, beforeID)
	}
	query += " ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?"
	rows, err := s.db.Query(query, append(args, limit, offset)...)
	if err != nil {
		return nil, fmt.Errorf("query history: %w", err)
	}
	defer rows.Close()
	entries := make([]HistoryEntry, 0, limit)
	ids := make([]string, 0, limit)
	for rows.Next() {
		entry, err := scanHistoryEntry(rows)
		if err != nil {
			return nil, err
		}
		entries = append(entries, entry)
		ids = append(ids, entry.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate history: %w", err)
	}
	if err := s.attachCalls(entries, ids); err != nil {
		return nil, err
	}
	return entries, nil
}

// Get 读取单条记录；不存在时返回 false 而不是错误，
// 界面上「已被删除」是正常分支。
func (s *HistoryStore) Get(id string) (HistoryEntry, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	row := s.db.QueryRow(`SELECT id, created_at, title, preview, transcript, organized, language,
			preset_id, preset_name, asr_model_id, llm_model_id, duration_ms, error
		FROM records WHERE id = ?`, id)
	entry, err := scanHistoryEntry(row)
	if errors.Is(err, sql.ErrNoRows) {
		return HistoryEntry{}, false, nil
	}
	if err != nil {
		return HistoryEntry{}, false, err
	}
	entries := []HistoryEntry{entry}
	if err := s.attachCalls(entries, []string{entry.ID}); err != nil {
		return HistoryEntry{}, false, err
	}
	return entries[0], true, nil
}

// attachCalls 一次性取回整页记录的调用明细，避免逐条查询。
func (s *HistoryStore) attachCalls(entries []HistoryEntry, ids []string) error {
	if len(ids) == 0 {
		return nil
	}
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	query := fmt.Sprintf("SELECT record_id, payload FROM record_calls WHERE record_id IN (%s) ORDER BY id", strings.Join(placeholders, ","))
	rows, err := s.db.Query(query, args...)
	if err != nil {
		return fmt.Errorf("query history calls: %w", err)
	}
	defer rows.Close()
	byRecord := make(map[string][]CallRecord, len(ids))
	for rows.Next() {
		var recordID, payload string
		if err := rows.Scan(&recordID, &payload); err != nil {
			return fmt.Errorf("scan history call: %w", err)
		}
		var call CallRecord
		if err := json.Unmarshal([]byte(payload), &call); err != nil {
			// 单条明细解不开不该让整页历史读不出来；
			// 丢掉这一条，其余照常展示。
			continue
		}
		byRecord[recordID] = append(byRecord[recordID], call)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate history calls: %w", err)
	}
	for i := range entries {
		entries[i].Calls = byRecord[entries[i].ID]
	}
	return nil
}

// Delete 删除单条记录，调用明细由外键级联删除。
func (s *HistoryStore) Delete(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.Exec("DELETE FROM records WHERE id = ?", id); err != nil {
		return fmt.Errorf("delete history record: %w", err)
	}
	return nil
}

// Clear 清空全部历史。
func (s *HistoryStore) Clear() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.db.Exec("DELETE FROM records"); err != nil {
		return fmt.Errorf("clear history: %w", err)
	}
	return nil
}

// Count 返回记录总数。
func (s *HistoryStore) Count() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var total int
	if err := s.db.QueryRow("SELECT COUNT(*) FROM records").Scan(&total); err != nil {
		return 0, fmt.Errorf("count history: %w", err)
	}
	return total, nil
}

// Prune 删除早于 before 的记录。返回删除条数，方便日志里说明
// 「本次启动清理了多少」。
func (s *HistoryStore) Prune(before time.Time) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.db.Exec("DELETE FROM records WHERE created_at < ?", before.UTC().Format(time.RFC3339Nano))
	if err != nil {
		return 0, fmt.Errorf("prune history: %w", err)
	}
	removed, err := result.RowsAffected()
	if err != nil {
		return 0, fmt.Errorf("count pruned history: %w", err)
	}
	return removed, nil
}

// ImportLegacy 把旧版 localStorage 里的记录导入数据库。它按 id
// 跳过已存在的条目，因此重复执行不会产生重复数据——迁移逻辑
// 最怕的就是「中途失败后重跑」。
func (s *HistoryStore) ImportLegacy(entries []HistoryEntry) (int, error) {
	s.mu.Lock()
	existing := make(map[string]bool, len(entries))
	for _, entry := range entries {
		if strings.TrimSpace(entry.ID) == "" {
			continue
		}
		var found int
		if err := s.db.QueryRow("SELECT COUNT(*) FROM records WHERE id = ?", entry.ID).Scan(&found); err != nil {
			s.mu.Unlock()
			return 0, fmt.Errorf("check legacy history: %w", err)
		}
		if found > 0 {
			existing[entry.ID] = true
		}
	}
	s.mu.Unlock()

	imported := 0
	for _, entry := range entries {
		if strings.TrimSpace(entry.ID) == "" || existing[entry.ID] {
			continue
		}
		if _, err := s.Save(entry); err != nil {
			return imported, err
		}
		imported++
	}
	return imported, nil
}

// normalizeHistoryEntry 补齐落库前的必填字段。标题与预览在界面
// 侧生成，但非界面调用方（迁移、测试）不一定填，这里按同一规则兜底。
func normalizeHistoryEntry(entry HistoryEntry) HistoryEntry {
	if entry.CreatedAt.IsZero() {
		entry.CreatedAt = time.Now().UTC()
	}
	entry.Transcript = strings.TrimSpace(entry.Transcript)
	entry.Organized = strings.TrimSpace(entry.Organized)
	if strings.TrimSpace(entry.Title) == "" {
		entry.Title = deriveHistoryTitle(entry.Organized)
	}
	if strings.TrimSpace(entry.Preview) == "" {
		entry.Preview = truncateRunes(entry.Transcript, 70)
	}
	return entry
}

// deriveHistoryTitle 取整理结果里的第一个标题；没有标题就回落到
// 固定文案，与界面上原有的规则一致。
func deriveHistoryTitle(organized string) string {
	for _, line := range strings.Split(organized, "\n") {
		trimmed := strings.TrimSpace(line)
		if !strings.HasPrefix(trimmed, "#") {
			continue
		}
		if title := strings.TrimSpace(strings.TrimLeft(trimmed, "#")); title != "" {
			return title
		}
	}
	return "未命名记录"
}

// truncateRunes 按字符截断，避免把多字节字符切成半个。
func truncateRunes(text string, limit int) string {
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	return string(runes[:limit])
}

// rowScanner 同时覆盖 *sql.Row 与 *sql.Rows，扫描逻辑只写一次。
type rowScanner interface {
	Scan(dest ...any) error
}

func scanHistoryEntry(row rowScanner) (HistoryEntry, error) {
	var entry HistoryEntry
	var createdAt string
	if err := row.Scan(&entry.ID, &createdAt, &entry.Title, &entry.Preview, &entry.Transcript,
		&entry.Organized, &entry.Language, &entry.PresetID, &entry.PresetName,
		&entry.ASRModelID, &entry.LLMModelID, &entry.DurationMS, &entry.Error); err != nil {
		return HistoryEntry{}, err
	}
	parsed, err := time.Parse(time.RFC3339Nano, createdAt)
	if err != nil {
		return HistoryEntry{}, fmt.Errorf("parse history timestamp %q: %w", createdAt, err)
	}
	entry.CreatedAt = parsed
	return entry, nil
}
