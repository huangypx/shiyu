package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

// configVersion 是当前配置文件的结构版本。加载时遇到更高的版本
// 直接拒绝：猜测未来字段的含义比明确报错更容易丢数据。
const configVersion = 2

const (
	// ASRModeTranscriptions 把音频以 multipart 形式发到
	// /audio/transcriptions，即 OpenAI Whisper 的接口约定。
	ASRModeTranscriptions = "transcriptions"
	// ASRModeChat 把音频作为 input_audio 片段发到
	// /chat/completions，多模态聊天模型就是这样暴露语音识别的。
	ASRModeChat = "chat"
)

// defaultModelID 与 defaultModelName 是迁移单模型配置时写入的
// 占位标识；用户新建的模型由前端生成随机 ID。
const (
	defaultModelID   = "default"
	defaultModelName = "默认模型"
)

// ASRConfig 描述一个 OpenAI 兼容的语音转写端点。
// BaseURL 可以指向服务商根地址（例如 https://api.openai.com/v1），
// 也可以直接指向具体端点；客户端会在缺少
// /audio/transcriptions 时自动补上。
type ASRConfig struct {
	// ID 是稳定标识，切换模型、写历史都靠它；改名不影响引用。
	ID   string `json:"id"`
	Name string `json:"name"`
	// Provider 只用于界面展示与调用记录，不影响请求形状。
	Provider string `json:"provider"`
	BaseURL  string `json:"baseUrl"`
	APIKey   string `json:"apiKey"`
	Model    string `json:"model"`
	// Language 为单个模型的语言覆盖；为空时用 section 层的全局值。
	Language string `json:"language,omitempty"`
	// Mode 选择服务商暴露语音识别的方式；零值表示
	// ASRModeTranscriptions。
	Mode string `json:"mode,omitempty"`
	// Stream 让服务商以 SSE 边生成边返回转写文字，界面因此能逐字
	// 上屏。只有对话接口支持；转写接口各网关行为不一，忽略该字段。
	// 音频仍然整段上传一次，这里不涉及任何切分。
	Stream bool `json:"stream,omitempty"`
}

// NormalizedASRMode 把任意已存取值映射到受支持的模式。
func (c ASRConfig) NormalizedASRMode() string {
	if c.Mode == ASRModeChat {
		return ASRModeChat
	}
	return ASRModeTranscriptions
}

// ASRSection 是语音识别的模型池。ActiveID 指向当前使用的那一个，
// 缺失或失效时按列表第一个兜底。
type ASRSection struct {
	ActiveID string `json:"activeId"`
	// Language 是全局识别语言；单个模型的 Language 优先。
	Language string      `json:"language,omitempty"`
	Models   []ASRConfig `json:"models"`
}

// LLMConfig 描述一个 OpenAI 兼容的聊天补全端点。
// 整理提示词不在这里：预设随预设走，兜底提示词在 section 层。
type LLMConfig struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Provider    string  `json:"provider"`
	BaseURL     string  `json:"baseUrl"`
	APIKey      string  `json:"apiKey"`
	Model       string  `json:"model"`
	Temperature float64 `json:"temperature,omitempty"`
}

// PolishPreset 是一组可命名的整理提示词。用户可以为不同输出目标
// 各准备一套提示词，再在记录页切换当前生效的那套。
type PolishPreset struct {
	ID           string `json:"id"`
	Name         string `json:"name"`
	SystemPrompt string `json:"systemPrompt"`
	// ModelID 让预设绑定某个 LLM 模型，代价敏感的场景可以给
	// 「精简去重」挂便宜模型、给「会议纪要」挂强模型。
	// 为空表示跟随 llm.activeId。
	ModelID string `json:"modelId,omitempty"`
}

// LLMSection 是文字整理的模型池。SystemPrompt 是兜底提示词，
// 不随模型切换；实际整理时优先使用生效预设里的提示词。
type LLMSection struct {
	ActiveID       string         `json:"activeId"`
	SystemPrompt   string         `json:"systemPrompt,omitempty"`
	Models         []LLMConfig    `json:"models"`
	Presets        []PolishPreset `json:"presets"`
	ActivePresetID string         `json:"activePresetId,omitempty"`
}

// 预设的容量与长度上限。提示词会被整段塞进 system 消息，交给
// 用户完全控制的自由文本需要一条硬边界，避免配置文件被写成
// 无法使用的巨型 JSON。
const (
	maxPolishPresets       = 24
	maxPolishPresetNameLen = 60
	maxPolishPromptBytes   = 8000
	maxModels              = 24
	maxModelNameLen        = 60
)

// languagePlaceholder 让用户在提示词里自行决定语言指令放在哪里。
// 出现该占位符时由后端替换成语言代码，且不再追加英文语言句。
const languagePlaceholder = "{{language}}"

// BubblePosition 记住用户把浮动圆圈停在哪里。
// 用指针是为了区分「未设置」与屏幕左上角
// 合法的 (0, 0) 坐标。
type BubblePosition struct {
	X int `json:"x"`
	Y int `json:"y"`
}

// DesktopConfig 控制属于宿主桌面、
// 而非模型服务商的行为。默认值刻意保守：
// 用户可以选择开启自动粘贴和浮动圆圈，
// 同时仍然掌控当前应用。
type DesktopConfig struct {
	Hotkey            string          `json:"hotkey"`
	AutoPaste         bool            `json:"autoPaste"`
	StartInBubble     bool            `json:"startInBubble"`
	KeepBubbleOnTop   bool            `json:"keepBubbleOnTop"`
	ShowResultPreview bool            `json:"showResultPreview"`
	RestoreClipboard  bool            `json:"restoreClipboard"`
	BubblePosition    *BubblePosition `json:"bubblePosition,omitempty"`
	// BubbleHidden 表示用户选择只保留托盘、隐藏悬浮球，跨重启持久化。
	// 唯一写入路径是 desktop.Controller.SetBubbleHidden；SaveDesktopConfig
	// 会像 BubblePosition 一样兜底保留它，设置面板保存不会重置隐藏态。
	// 用 bool 零值天然兼容旧配置，configVersion 保持 2 不变。
	BubbleHidden bool `json:"bubbleHidden,omitempty"`
	// CloseAction 决定关闭主窗口时的行为：ask 每次询问、background
	// 后台运行、quit 直接退出。唯一写入路径是关闭确认框 ResolveClose；
	// SaveDesktopConfig 会像 BubbleHidden 一样兜底保留，面板保存不重置。
	CloseAction string `json:"closeAction,omitempty"`
	// HistoryRetentionDays 为 0 表示永久保留；大于 0 时在启动阶段
	// 删除更早的记录。用天数而不是条数：SQLite 里按时间裁剪更直观，
	// 也不依赖用户理解「第 N 条之后会消失」。
	HistoryRetentionDays int `json:"historyRetentionDays"`
}

// Config 是持久化的应用配置。API key 按用户填写原样保存，
// 后端永远不会把它写进日志。
type Config struct {
	Version int           `json:"version"`
	ASR     ASRSection    `json:"asr"`
	LLM     LLMSection    `json:"llm"`
	Desktop DesktopConfig `json:"desktop"`
}

func DefaultConfig() Config {
	return Config{
		Version: configVersion,
		ASR: ASRSection{
			ActiveID: defaultModelID,
			Models: []ASRConfig{{
				ID:       defaultModelID,
				Name:     defaultModelName,
				Provider: "openai-compatible",
				BaseURL:  "https://api.openai.com/v1",
				Model:    "gpt-4o-mini-transcribe",
			}},
		},
		LLM: LLMSection{
			ActiveID:     defaultModelID,
			SystemPrompt: defaultSystemPrompt,
			Models: []LLMConfig{{
				ID:          defaultModelID,
				Name:        defaultModelName,
				Provider:    "openai-compatible",
				BaseURL:     "https://api.openai.com/v1",
				Model:       "gpt-4o-mini",
				Temperature: 0.2,
			}},
			Presets:        defaultPolishPresets(),
			ActivePresetID: defaultActivePresetID,
		},
		Desktop: DesktopConfig{
			Hotkey:               defaultHotkey(),
			AutoPaste:            true,
			StartInBubble:        false,
			KeepBubbleOnTop:      true,
			ShowResultPreview:    true,
			RestoreClipboard:     true,
			CloseAction:          "ask",
			HistoryRetentionDays: 0,
		},
	}
}

// defaultHotkey 按平台选择全局快捷键默认值。已保存的配置不受
// 影响：applyDefaults 只在 Hotkey 为空时回填。
func defaultHotkey() string {
	return defaultHotkeyFor(runtime.GOOS)
}

// defaultHotkeyFor 是平台默认热键的唯一真源，前端
// types/models.ts 的 defaultHotkeyFor 镜像同一张表。
func defaultHotkeyFor(goos string) string {
	switch goos {
	case "darwin":
		return "Option+Space"
	case "windows":
		// Alt+Space 本是系统窗口菜单快捷键，RegisterHotKey 注册
		// 成功后会全局抢占；被占用时设置页提示改键。
		return "Alt+Space"
	default:
		return "Ctrl+Shift+Space"
	}
}

const defaultSystemPrompt = "You clean up dictated text. Preserve the speaker's meaning and language, fix punctuation and obvious transcription errors, remove filler words, and return only the polished text."

// defaultActivePresetID 指向内置的「默认整理」预设，保证首次启动
// 的输出与此前写死提示词时完全一致。
const defaultActivePresetID = "default"

// defaultPolishPresets 返回内置预设的副本。调用方可能直接改动
// 配置里的切片，不能让它和包级常量共享底层数组。
func defaultPolishPresets() []PolishPreset {
	return []PolishPreset{
		{ID: defaultActivePresetID, Name: "默认整理", SystemPrompt: defaultSystemPrompt},
		{ID: "concise", Name: "精简去重", SystemPrompt: concisePolishPrompt},
		{ID: "markdown", Name: "Markdown 结构", SystemPrompt: markdownPolishPrompt},
		{ID: "meeting", Name: "会议纪要", SystemPrompt: meetingPolishPrompt},
	}
}

// 以下三段是给用户改的示例预设，因此写成中文，并示范
// {{language}} 占位符的用法：语言指令可以放在句子里，
// 而不是被后端拼到末尾。
const concisePolishPrompt = "你负责精简口述文本。保留原意与说话人的语言（{{language}}），" +
	"删除重复表述、口头禅和语气词，把语义重复的短句合并成一句，" +
	"不要新增信息，不要改写成提纲或列表，只输出整理后的正文。"

const markdownPolishPrompt = "你把口述内容整理成结构化 Markdown，语言为 {{language}}。" +
	"按内容层级给出标题、要点列表和任务列表（- [ ] 待办），补全标点并删除口头禅，" +
	"不添加原文没有的事实，只输出 Markdown 正文，不要用代码块包裹整体结果。"

const meetingPolishPrompt = "你把口述内容整理成会议纪要，语言为 {{language}}。" +
	"在合适的段落列出时间、参与者、讨论重点与可执行待办（- [ ]），" +
	"信息缺失时直接省略对应条目，不要编造，只输出纪要正文。"

// ConfigStore 把配置持久化为一个小 JSON 文件。
// Save 先写临时文件再重命名，进程中断也不会
// 留下写了一半的配置。
type ConfigStore struct {
	path string
	mu   sync.Mutex

	// 记录上次读取时的文件指纹，用于发现用户在应用运行时
	// 手工改过配置。零值表示还没成功读过。
	modTime   time.Time
	size      int64
	lastWarn  string
	loadedOne bool
}

func NewConfigStore(path string) *ConfigStore {
	return &ConfigStore{path: path}
}

func (s *ConfigStore) Path() string { return s.path }

// Warning 返回最近一次读取时的非致命问题，例如无法解析的
// env: 凭证引用。它不会阻止配置加载，只让界面能说明原因。
func (s *ConfigStore) Warning() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.lastWarn
}

func (s *ConfigStore) Load() (Config, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

// LoadIfChanged 只在文件指纹变化时重新解析。changed 为 false 时
// 调用方可以直接继续用内存里的配置。
func (s *ConfigStore) LoadIfChanged() (Config, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, err := os.Stat(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// 文件被删除时保持内存配置不变：用户可能是误删，
			// 悄悄重置成默认值会让他失去正在使用的设置。
			return Config{}, false, nil
		}
		return Config{}, false, nil
	}
	if s.loadedOne && info.ModTime().Equal(s.modTime) && info.Size() == s.size {
		return Config{}, false, nil
	}
	cfg, err := s.loadLocked()
	if err != nil {
		// 半保存或手改坏的文件不能打挂应用，也不能覆盖内存配置。
		s.lastWarn = err.Error()
		return Config{}, false, err
	}
	return cfg, true, nil
}

func (s *ConfigStore) loadLocked() (Config, error) {
	if s.path == "" {
		return Config{}, errors.New("config path is empty")
	}
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		// 首次启动不写盘，等用户保存设置时再创建文件。
		s.loadedOne = false
		return DefaultConfig(), nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}
	cfg, err := decodeConfig(data)
	if err != nil {
		return Config{}, err
	}
	cfg.applyDefaults()
	s.lastWarn = resolveSecretWarning(cfg)
	s.stamp()
	return cfg, nil
}

// stamp 记下当前文件指纹，避免保存后立刻把自己的写入当成外部修改。
func (s *ConfigStore) stamp() {
	info, err := os.Stat(s.path)
	if err != nil {
		s.loadedOne = false
		return
	}
	s.modTime = info.ModTime()
	s.size = info.Size()
	s.loadedOne = true
}

// decodeConfig 按 version 选择解析路径。缺失 version 的文件一律
// 当作 v1：v1 是唯一存在过的无版本格式。
func decodeConfig(data []byte) (Config, error) {
	var probe struct {
		Version int `json:"version"`
		ASR     struct {
			Models []ASRConfig `json:"models"`
		} `json:"asr"`
	}
	if err := json.Unmarshal(data, &probe); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	switch {
	case probe.Version > configVersion:
		return Config{}, fmt.Errorf("config version %d is newer than supported version %d", probe.Version, configVersion)
	case probe.Version == configVersion:
		var c Config
		if err := json.Unmarshal(data, &c); err != nil {
			return Config{}, fmt.Errorf("decode config: %w", err)
		}
		return c, nil
	case probe.Version == 0 && len(probe.ASR.Models) > 0:
		// 写盘时永远带 version；没有 version 却有 models，
		// 说明是手工编辑过的新格式文件，按 v2 读。
		var c Config
		if err := json.Unmarshal(data, &c); err != nil {
			return Config{}, fmt.Errorf("decode config: %w", err)
		}
		return c, nil
	default:
		var legacy v1Config
		if err := json.Unmarshal(data, &legacy); err != nil {
			return Config{}, fmt.Errorf("decode legacy config: %w", err)
		}
		return legacy.migrate(), nil
	}
}

func (s *ConfigStore) Save(c Config) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.path == "" {
		return errors.New("config path is empty")
	}
	c.applyDefaults()
	if err := c.Validate(); err != nil {
		return err
	}
	data, err := json.MarshalIndent(c, "", "  ")
	if err != nil {
		return fmt.Errorf("encode config: %w", err)
	}
	dir := filepath.Dir(s.path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return fmt.Errorf("create config directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".config-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return fmt.Errorf("protect temporary config: %w", err)
	}
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return fmt.Errorf("write config: %w", err)
	}
	if err := tmp.Sync(); err != nil {
		tmp.Close()
		return fmt.Errorf("flush config: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return fmt.Errorf("close config: %w", err)
	}
	if err := os.Rename(tmpName, s.path); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	s.stamp()
	return nil
}
