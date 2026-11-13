package backend

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"unicode/utf8"
)

// 这一份文件只放配置的「修补与校验」逻辑：默认值回填、v1 迁移、
// 凭证解析和硬约束。加载与写盘在 config.go 里，读代码时可以
// 分别看「怎么存」和「存什么算合法」。

// v1Config 是改成模型池之前的单模型结构。它只用于迁移，
// 不再参与任何运行路径。
type v1Config struct {
	ASR struct {
		Provider string `json:"provider"`
		BaseURL  string `json:"baseUrl"`
		APIKey   string `json:"apiKey"`
		Model    string `json:"model"`
		Language string `json:"language,omitempty"`
		Mode     string `json:"mode,omitempty"`
	} `json:"asr"`
	LLM struct {
		Provider     string         `json:"provider"`
		BaseURL      string         `json:"baseUrl"`
		APIKey       string         `json:"apiKey"`
		Model        string         `json:"model"`
		Temperature  float64        `json:"temperature,omitempty"`
		SystemPrompt string         `json:"systemPrompt,omitempty"`
		Presets      []PolishPreset `json:"presets,omitempty"`
		ActivePreset string         `json:"activePresetId,omitempty"`
	} `json:"llm"`
	Desktop struct {
		Hotkey             string          `json:"hotkey"`
		AutoPaste          bool            `json:"autoPaste"`
		StartInBubble      bool            `json:"startInBubble"`
		KeepBubbleOnTop    bool            `json:"keepBubbleOnTop"`
		ShowResultPreview  bool            `json:"showResultPreview"`
		RestoreClipboard   bool            `json:"restoreClipboard"`
		ResultHistoryLimit int             `json:"resultHistoryLimit"`
		BubblePosition     *BubblePosition `json:"bubblePosition,omitempty"`
	} `json:"desktop"`
}

// migrate 把单模型配置摊成模型池。旧版只有一个端点，因此
// 模型池里也只放一个，行为完全不变。
func (c v1Config) migrate() Config {
	cfg := Config{
		Version: configVersion,
		ASR: ASRSection{
			ActiveID: defaultModelID,
			Language: strings.TrimSpace(c.ASR.Language),
			Models: []ASRConfig{{
				ID:       defaultModelID,
				Name:     defaultModelName,
				Provider: c.ASR.Provider,
				BaseURL:  c.ASR.BaseURL,
				APIKey:   c.ASR.APIKey,
				Model:    c.ASR.Model,
				Mode:     c.ASR.Mode,
			}},
		},
		LLM: LLMSection{
			ActiveID:     defaultModelID,
			SystemPrompt: c.LLM.SystemPrompt,
			Models: []LLMConfig{{
				ID:          defaultModelID,
				Name:        defaultModelName,
				Provider:    c.LLM.Provider,
				BaseURL:     c.LLM.BaseURL,
				APIKey:      c.LLM.APIKey,
				Model:       c.LLM.Model,
				Temperature: c.LLM.Temperature,
			}},
			Presets:        c.LLM.Presets,
			ActivePresetID: c.LLM.ActivePreset,
		},
		Desktop: DesktopConfig{
			Hotkey:               c.Desktop.Hotkey,
			AutoPaste:            c.Desktop.AutoPaste,
			StartInBubble:        c.Desktop.StartInBubble,
			KeepBubbleOnTop:      c.Desktop.KeepBubbleOnTop,
			ShowResultPreview:    c.Desktop.ShowResultPreview,
			RestoreClipboard:     c.Desktop.RestoreClipboard,
			BubblePosition:       c.Desktop.BubblePosition,
			HistoryRetentionDays: 0,
		},
	}
	// 旧版用条数限制历史；SQLite 改成按时间裁剪，这里不做换算，
	// 保留期默认永久，避免迁移时静默删掉用户的历史。
	return cfg
}

// applyDefaults 把缺失字段补成可用值。它同时承担「旧配置升级」
// 与「手改坏的文件自愈」两个职责，因此每个字段都要能独立兜底。
func (c *Config) applyDefaults() {
	d := DefaultConfig()
	if c.Version == 0 {
		c.Version = configVersion
	}
	c.ASR.applyDefaults(d.ASR)
	c.LLM.applyDefaults(d.LLM)
	c.Desktop.applyDefaults(d.Desktop)
}

func (s *ASRSection) applyDefaults(d ASRSection) {
	if strings.TrimSpace(s.Language) == "" {
		s.Language = d.Language
	}
	if len(s.Models) == 0 {
		s.Models = append([]ASRConfig(nil), d.Models...)
	}
	used := make(map[string]bool, len(s.Models))
	for i := range s.Models {
		model := &s.Models[i]
		model.ID = strings.TrimSpace(model.ID)
		model.Name = strings.TrimSpace(model.Name)
		model.Provider = strings.TrimSpace(model.Provider)
		model.BaseURL = strings.TrimSpace(model.BaseURL)
		model.Model = strings.TrimSpace(model.Model)
		model.Language = strings.TrimSpace(model.Language)
		if model.ID == "" || used[model.ID] {
			model.ID = nextModelID(used)
		}
		used[model.ID] = true
		if model.Name == "" {
			model.Name = model.Model
		}
		if model.Name == "" {
			model.Name = defaultModelName
		}
		if model.Provider == "" {
			model.Provider = "openai-compatible"
		}
		if model.BaseURL == "" {
			model.BaseURL = d.Models[0].BaseURL
		}
		if model.Model == "" {
			model.Model = d.Models[0].Model
		}
		if strings.TrimSpace(model.Mode) == "" {
			model.Mode = ASRModeTranscriptions
		}
	}
	s.ActiveID = strings.TrimSpace(s.ActiveID)
	if s.ActiveID == "" || !containsASRModel(s.Models, s.ActiveID) {
		s.ActiveID = s.Models[0].ID
	}
}

const legacyDefaultSystemPrompt = "You clean up dictated text. Preserve the speaker's meaning and language, fix punctuation and obvious transcription errors, remove filler words, and return only the polished text."
const legacyConcisePolishPrompt = "你负责精简口述文本。保留原意与说话人的语言（{{language}}），" +
	"删除重复表述、口头禅和语气词，把语义重复的短句合并成一句，" +
	"不要新增信息，不要改写成提纲或列表，只输出整理后的正文。"

var builtinPromptUpgrades = map[string]struct{ previous, current string }{
	defaultActivePresetID: {legacyDefaultSystemPrompt, defaultSystemPrompt},
	"concise":             {legacyConcisePolishPrompt, concisePolishPrompt},
	"markdown":            {legacyMarkdownPolishPrompt, markdownPolishPrompt},
	"meeting":             {legacyMeetingPolishPrompt, meetingPolishPrompt},
}

func (s *LLMSection) applyDefaults(d LLMSection) {
	if prompt := strings.TrimSpace(s.SystemPrompt); prompt == "" || prompt == legacyDefaultSystemPrompt {
		s.SystemPrompt = d.SystemPrompt
	}
	if len(s.Models) == 0 {
		s.Models = append([]LLMConfig(nil), d.Models...)
	}
	used := make(map[string]bool, len(s.Models))
	for i := range s.Models {
		model := &s.Models[i]
		model.ID = strings.TrimSpace(model.ID)
		model.Name = strings.TrimSpace(model.Name)
		model.Provider = strings.TrimSpace(model.Provider)
		model.BaseURL = strings.TrimSpace(model.BaseURL)
		model.Model = strings.TrimSpace(model.Model)
		if model.ID == "" || used[model.ID] {
			model.ID = nextModelID(used)
		}
		used[model.ID] = true
		if model.Name == "" {
			model.Name = model.Model
		}
		if model.Name == "" {
			model.Name = defaultModelName
		}
		if model.Provider == "" {
			model.Provider = "openai-compatible"
		}
		if model.BaseURL == "" {
			model.BaseURL = d.Models[0].BaseURL
		}
		if model.Model == "" {
			model.Model = d.Models[0].Model
		}
	}
	s.ActiveID = strings.TrimSpace(s.ActiveID)
	if s.ActiveID == "" || !containsLLMModel(s.Models, s.ActiveID) {
		s.ActiveID = s.Models[0].ID
	}
	s.applyPresetDefaults(d)
}

// applyPresetDefaults 负责三件事：把缺失的预设补成内置列表、
// 把用户手改过的条目归一回可用状态、让失效的模型绑定回落。
// 零预设有两种来源——首次启动的配置，和手改坏的文件——两者都
// 补回内置预设，应用才总能找到一个生效提示词。
func (s *LLMSection) applyPresetDefaults(d LLMSection) {
	if len(s.Presets) == 0 {
		// 旧版本把用户手改的提示词存在 systemPrompt 里；升级时
		// 把它变成「我的整理」预设，不要悄悄丢掉用户写过的东西。
		if legacy := strings.TrimSpace(s.SystemPrompt); legacy != "" && legacy != defaultSystemPrompt {
			s.Presets = []PolishPreset{{ID: "custom", Name: "我的整理", SystemPrompt: legacy}}
			s.ActivePresetID = "custom"
		} else {
			s.Presets = clonePolishPresets(d.Presets)
			s.ActivePresetID = defaultActivePresetID
		}
		return
	}
	used := make(map[string]bool, len(s.Presets))
	for i := range s.Presets {
		preset := &s.Presets[i]
		preset.ID = strings.TrimSpace(preset.ID)
		preset.Name = strings.TrimSpace(preset.Name)
		preset.SystemPrompt = strings.TrimSpace(preset.SystemPrompt)
		preset.ModelID = strings.TrimSpace(preset.ModelID)
		if preset.ID == "" || used[preset.ID] {
			preset.ID = nextPresetID(used)
		}
		used[preset.ID] = true
		// 只更新对应内置预设的原版提示词，用户编辑的内容和另存的副本各自保留。
		if upgrade, ok := builtinPromptUpgrades[preset.ID]; ok && preset.SystemPrompt == upgrade.previous {
			preset.SystemPrompt = upgrade.current
		}
		// 绑定的模型可能已经被删掉；清空绑定即回到「跟随全局」，
		// 比留下一串指向不存在模型的 ID 更容易解释。
		if preset.ModelID != "" && !containsLLMModel(s.Models, preset.ModelID) {
			preset.ModelID = ""
		}
	}
	if active := strings.TrimSpace(s.ActivePresetID); containsPresetID(s.Presets, active) {
		s.ActivePresetID = active
		return
	}
	// 生效 ID 指向不存在的预设时清空它，交给 ResolvePolishPreset
	// 回落到列表第一个；Validate 允许空的生效 ID，这样 SaveConfig
	// 收到的旧配置不会被一条无关的引用错误拦下。
	s.ActivePresetID = ""
}

func (d *DesktopConfig) applyDefaults(def DesktopConfig) {
	if d.CloseAction != "background" && d.CloseAction != "quit" {
		d.CloseAction = def.CloseAction
	}
	if strings.TrimSpace(d.Hotkey) == "" {
		d.Hotkey = def.Hotkey
	}
	if d.HistoryRetentionDays < 0 {
		d.HistoryRetentionDays = 0
	}
}

// nextModelID 在 ID 缺失或重复时给出稳定可读的替补。
func nextModelID(used map[string]bool) string {
	for i := 1; ; i++ {
		id := fmt.Sprintf("model-%d", i)
		if !used[id] {
			return id
		}
	}
}

func containsASRModel(models []ASRConfig, id string) bool {
	for _, model := range models {
		if model.ID == id {
			return true
		}
	}
	return false
}

func containsLLMModel(models []LLMConfig, id string) bool {
	for _, model := range models {
		if model.ID == id {
			return true
		}
	}
	return false
}

// nextPresetID 在 ID 缺失或重复时给出一个稳定可读的替补，
// 数字从 1 开始递增，因此结果可预测、也方便用户在 JSON 里辨认。
func nextPresetID(used map[string]bool) string {
	for i := 1; ; i++ {
		id := fmt.Sprintf("preset-%d", i)
		if !used[id] {
			return id
		}
	}
}

// hasPreset 只判断 ID 是否在列表里，不做生效 ID 回退；
// 回退由 ResolvePolishPreset 负责，两者的语义不能混用。
func containsPresetID(presets []PolishPreset, id string) bool {
	if strings.TrimSpace(id) == "" {
		return false
	}
	for _, preset := range presets {
		if preset.ID == id {
			return true
		}
	}
	return false
}

// ResolvePolishPreset 按「指定 ID → 生效 ID → 列表第一个」的顺序
// 解析出要用的预设。返回 false 只可能来自被手改成零预设的配置，
// 此时调用方应回落到 defaultSystemPrompt。
func (c Config) ResolvePolishPreset(id string) (PolishPreset, bool) {
	if preset, ok := c.presetByID(id); ok {
		return preset, true
	}
	if preset, ok := c.presetByID(c.LLM.ActivePresetID); ok {
		return preset, true
	}
	if len(c.LLM.Presets) > 0 {
		return c.LLM.Presets[0], true
	}
	return PolishPreset{}, false
}

func (c Config) presetByID(id string) (PolishPreset, bool) {
	if strings.TrimSpace(id) == "" {
		return PolishPreset{}, false
	}
	for _, preset := range c.LLM.Presets {
		if preset.ID == id {
			return preset, true
		}
	}
	return PolishPreset{}, false
}

// ResolveASRModel 返回指定 ID 的模型；ID 为空或失效时回落到
// 当前生效模型。第二个返回值表示配置里到底有没有可用的模型。
func (c Config) ResolveASRModel(id string) (ASRConfig, bool) {
	id = strings.TrimSpace(id)
	for _, model := range c.ASR.Models {
		if model.ID == id {
			return model, true
		}
	}
	for _, model := range c.ASR.Models {
		if model.ID == c.ASR.ActiveID {
			return model, true
		}
	}
	if len(c.ASR.Models) > 0 {
		return c.ASR.Models[0], true
	}
	return ASRConfig{}, false
}

// ResolveLLMModel 解析一次整理实际使用的模型：预设绑定了模型
// 就用预设的，否则用当前生效模型。
func (c Config) ResolveLLMModel(preset PolishPreset) (LLMConfig, bool) {
	if preset.ModelID != "" {
		for _, model := range c.LLM.Models {
			if model.ID == preset.ModelID {
				return model, true
			}
		}
	}
	for _, model := range c.LLM.Models {
		if model.ID == c.LLM.ActiveID {
			return model, true
		}
	}
	if len(c.LLM.Models) > 0 {
		return c.LLM.Models[0], true
	}
	return LLMConfig{}, false
}

// ASRLanguage 返回该模型实际使用的识别语言：模型自己填了就用它，
// 否则用 section 层的全局语言。
func (c Config) ASRLanguage(model ASRConfig) string {
	if language := strings.TrimSpace(model.Language); language != "" {
		return language
	}
	return strings.TrimSpace(c.ASR.Language)
}

// clonePolishPresets 复制预设切片。配置会按值在多个 goroutine 之间
// 传递，但切片头是共享的，写回前必须断开这层引用。
func clonePolishPresets(presets []PolishPreset) []PolishPreset {
	if len(presets) == 0 {
		return nil
	}
	return append([]PolishPreset(nil), presets...)
}

func cloneASRModels(models []ASRConfig) []ASRConfig {
	if len(models) == 0 {
		return nil
	}
	return append([]ASRConfig(nil), models...)
}

func cloneLLMModels(models []LLMConfig) []LLMConfig {
	if len(models) == 0 {
		return nil
	}
	return append([]LLMConfig(nil), models...)
}

// SecretEnvPrefix 与 SecretFilePrefix 让配置里只写引用，把真正的
// 密钥留在环境变量或独立文件里。对 dotfiles 用户来说，这是
// 「配置文件可以进版本库」与「密钥不进版本库」之间的折中。
const (
	SecretEnvPrefix  = "env:"
	SecretFilePrefix = "file:"
)

// ResolveSecret 展开 env: / file: 两种间接引用。普通字符串原样
// 返回，因此老配置文件无需任何改动。
func ResolveSecret(raw string) (string, error) {
	value := strings.TrimSpace(raw)
	switch {
	case strings.HasPrefix(value, SecretEnvPrefix):
		name := strings.TrimSpace(strings.TrimPrefix(value, SecretEnvPrefix))
		if name == "" {
			return "", errors.New("api key references an empty environment variable name")
		}
		secret, ok := os.LookupEnv(name)
		if !ok || strings.TrimSpace(secret) == "" {
			return "", fmt.Errorf("environment variable %s is not set", name)
		}
		return strings.TrimSpace(secret), nil
	case strings.HasPrefix(value, SecretFilePrefix):
		path := strings.TrimSpace(strings.TrimPrefix(value, SecretFilePrefix))
		if path == "" {
			return "", errors.New("api key references an empty file path")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return "", fmt.Errorf("read api key file: %w", err)
		}
		secret := strings.TrimSpace(string(data))
		if secret == "" {
			return "", fmt.Errorf("api key file %s is empty", path)
		}
		return secret, nil
	default:
		return value, nil
	}
}

// resolveSecretWarning 汇总所有解析失败的凭证引用。它只用于
// 提示，不阻止配置加载：启动时环境变量没准备好是常见情况，
// 真正发起调用时 ResolveSecret 会再报一次具体错误。
func resolveSecretWarning(c Config) string {
	var problems []string
	for _, model := range c.ASR.Models {
		if _, err := ResolveSecret(model.APIKey); err != nil {
			problems = append(problems, fmt.Sprintf("asr %q: %v", model.Name, err))
		}
	}
	for _, model := range c.LLM.Models {
		if _, err := ResolveSecret(model.APIKey); err != nil {
			problems = append(problems, fmt.Sprintf("llm %q: %v", model.Name, err))
		}
	}
	if len(problems) == 0 {
		return ""
	}
	return strings.Join(problems, "; ")
}

// validateModels 把模型池的硬约束集中在一处：数量、必填、ID 唯一。
func validateASRModels(section ASRSection) error {
	if len(section.Models) == 0 {
		return errors.New("at least one asr model is required")
	}
	if len(section.Models) > maxModels {
		return fmt.Errorf("at most %d asr models are supported", maxModels)
	}
	seen := make(map[string]bool, len(section.Models))
	for i, model := range section.Models {
		if strings.TrimSpace(model.ID) == "" {
			return fmt.Errorf("asr model %d is missing an id", i+1)
		}
		if seen[model.ID] {
			return fmt.Errorf("asr model id %q is duplicated", model.ID)
		}
		seen[model.ID] = true
		if utf8.RuneCountInString(strings.TrimSpace(model.Name)) > maxModelNameLen {
			return fmt.Errorf("asr model name %q is longer than %d characters", model.ID, maxModelNameLen)
		}
		if err := validateEndpoint(model.BaseURL); err != nil {
			return fmt.Errorf("asr model %q: %w", model.ID, err)
		}
		if strings.TrimSpace(model.Model) == "" {
			return fmt.Errorf("asr model %q is missing a model name", model.ID)
		}
		switch model.NormalizedASRMode() {
		case ASRModeTranscriptions, ASRModeChat:
		default:
			return fmt.Errorf("asr mode %q is not supported", model.Mode)
		}
	}
	if active := strings.TrimSpace(section.ActiveID); active != "" && !seen[active] {
		return fmt.Errorf("active asr model %q is not in the model list", active)
	}
	return nil
}

func validateLLMModels(section LLMSection) error {
	if len(section.Models) == 0 {
		return errors.New("at least one llm model is required")
	}
	if len(section.Models) > maxModels {
		return fmt.Errorf("at most %d llm models are supported", maxModels)
	}
	seen := make(map[string]bool, len(section.Models))
	for i, model := range section.Models {
		if strings.TrimSpace(model.ID) == "" {
			return fmt.Errorf("llm model %d is missing an id", i+1)
		}
		if seen[model.ID] {
			return fmt.Errorf("llm model id %q is duplicated", model.ID)
		}
		seen[model.ID] = true
		if utf8.RuneCountInString(strings.TrimSpace(model.Name)) > maxModelNameLen {
			return fmt.Errorf("llm model name %q is longer than %d characters", model.ID, maxModelNameLen)
		}
		if err := validateEndpoint(model.BaseURL); err != nil {
			return fmt.Errorf("llm model %q: %w", model.ID, err)
		}
		if strings.TrimSpace(model.Model) == "" {
			return fmt.Errorf("llm model %q is missing a model name", model.ID)
		}
		if model.Temperature < 0 || model.Temperature > 2 {
			return errors.New("llm temperature must be between 0 and 2")
		}
	}
	if active := strings.TrimSpace(section.ActiveID); active != "" && !seen[active] {
		return fmt.Errorf("active llm model %q is not in the model list", active)
	}
	return nil
}

func validateEndpoint(raw string) error {
	value := strings.TrimSpace(raw)
	if value == "" {
		return errors.New("base URL is required")
	}
	u, err := url.Parse(value)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return fmt.Errorf("invalid base URL %q", value)
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return fmt.Errorf("base URL %q must be http or https", value)
	}
	return nil
}

// validatePresets 把预设的硬约束集中在一处：数量、必填、长度和
// ID 唯一性。用户编辑的自由文本只有在这里拦得住，界面校验只是
// 提前提示。
func (c Config) validatePresets() error {
	presets := c.LLM.Presets
	if len(presets) == 0 {
		return errors.New("at least one polish preset is required")
	}
	if len(presets) > maxPolishPresets {
		return fmt.Errorf("at most %d polish presets are supported", maxPolishPresets)
	}
	seen := make(map[string]bool, len(presets))
	for i, preset := range presets {
		if strings.TrimSpace(preset.ID) == "" {
			return fmt.Errorf("polish preset %d is missing an id", i+1)
		}
		if seen[preset.ID] {
			return fmt.Errorf("polish preset id %q is duplicated", preset.ID)
		}
		seen[preset.ID] = true
		if strings.TrimSpace(preset.Name) == "" {
			return fmt.Errorf("polish preset %q is missing a name", preset.ID)
		}
		if utf8.RuneCountInString(preset.Name) > maxPolishPresetNameLen {
			return fmt.Errorf("polish preset name %q is longer than %d characters", preset.ID, maxPolishPresetNameLen)
		}
		if strings.TrimSpace(preset.SystemPrompt) == "" {
			return fmt.Errorf("polish preset %q is missing a system prompt", preset.ID)
		}
		if len(preset.SystemPrompt) > maxPolishPromptBytes {
			return fmt.Errorf("polish preset %q prompt is longer than %d bytes", preset.ID, maxPolishPromptBytes)
		}
		if preset.ModelID != "" && !containsLLMModel(c.LLM.Models, preset.ModelID) {
			return fmt.Errorf("polish preset %q references unknown model %q", preset.ID, preset.ModelID)
		}
	}
	if active := strings.TrimSpace(c.LLM.ActivePresetID); active != "" && !seen[active] {
		return fmt.Errorf("active polish preset %q is not in the preset list", active)
	}
	return nil
}

func (c Config) Validate() error {
	if c.Version > configVersion {
		return fmt.Errorf("config version %d is newer than supported version %d", c.Version, configVersion)
	}
	if err := validateASRModels(c.ASR); err != nil {
		return err
	}
	if err := validateLLMModels(c.LLM); err != nil {
		return err
	}
	if strings.TrimSpace(c.Desktop.Hotkey) == "" {
		return errors.New("desktop hotkey is required")
	}
	if c.Desktop.HistoryRetentionDays < 0 {
		return errors.New("desktop history retention must not be negative")
	}
	// 预设校验放在最后：它只管整理提示词，前面的字段错误
	// 更基础，报出来对用户更有用。
	return c.validatePresets()
}
