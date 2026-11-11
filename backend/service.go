package backend

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"
)

// 服务层负责三件事：持有当前配置、按配置构建模型池、把一次录音
// 或一段文本送进正确的模型。持久化的细节都在 config*.go 与
// history_store.go，这里只做编排。

// App 是对 Wails 暴露的服务。所有方法都使用可 JSON 序列化的普通
// 结构体，因此浏览器桥或测试也能直接调用。
type App struct {
	store *ConfigStore

	mu      sync.RWMutex
	config  Config
	asr     map[string]ASRProvider
	llm     map[string]LLMProvider
	history *HistoryStore

	recording  *recording
	calls      []CallRecord
	callLimit  int
	httpClient *http.Client
	// emit 由宿主注入，nil 表示不向界面推送任何事件。
	emit Emitter
	// active 是当前在途的转写或整理调用，取消录音时用它中断
	// 服务商请求；两个阶段共用一份，因为流水线是串行的。
	active *activeCall
	// configWarning 保存最近一次配置读取或热重载的问题，
	// 界面用它解释「为什么模型看起来没生效」。
	configWarning string
}

// activeCall 只为了能用指针判断「清除的是不是自己登记的那一个」，
// 函数值本身不可比较。
type activeCall struct {
	cancel context.CancelFunc
}

type recording struct {
	id        string
	startedAt time.Time
	filename  string
	mimeType  string
	language  string
	prompt    string
	data      []byte
}

// NewApp 从 configPath 读取配置并据此构建模型池。
// 配置文件缺失时用安全默认值初始化，
// 但在用户保存设置之前不会写盘。
func NewApp(configPath string) (*App, error) {
	if strings.TrimSpace(configPath) == "" {
		return nil, errors.New("config path is empty")
	}
	store := NewConfigStore(configPath)
	cfg, err := store.Load()
	if err != nil {
		return nil, err
	}
	a := &App{store: store, config: cfg, callLimit: defaultCallLimit, httpClient: &http.Client{Timeout: 2 * time.Minute}}
	if err := a.rebuildProvidersLocked(); err != nil {
		return nil, err
	}
	return a, nil
}

// NewAppWithConfig 适合嵌入和测试场景，不需要持久化。
// store 为 nil 时 SaveConfig 会返回错误。
func NewAppWithConfig(cfg Config, store *ConfigStore) (*App, error) {
	cfg.applyDefaults()
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	a := &App{store: store, config: cfg, callLimit: defaultCallLimit, httpClient: &http.Client{Timeout: 2 * time.Minute}}
	if err := a.rebuildProvidersLocked(); err != nil {
		return nil, err
	}
	return a, nil
}

// AttachEmitter 注入向界面推送事件的通道。它必须在 Run 之前调用；
// 传入 nil 表示静默（浏览器预览与测试就是这种情况）。
func AttachEmitter(a *App, emit Emitter) {
	if a == nil {
		return
	}
	a.mu.Lock()
	a.emit = emit
	a.mu.Unlock()
}

// eventEmitter 在读锁下取一次当前回调，避免热路径上反复加锁。
func (a *App) eventEmitter() Emitter {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.emit
}

// beginCall 为一次服务商调用派生出可取消的 context，并登记为当前
// 在途调用。返回的收尾函数只清除自己登记的那一个，这样取消旧请求
// 不会顺手抹掉新请求的取消能力。
func (a *App) beginCall(ctx context.Context) (context.Context, func()) {
	runCtx, cancel := context.WithCancel(ctx)
	call := &activeCall{cancel: cancel}
	a.mu.Lock()
	a.active = call
	a.mu.Unlock()
	return runCtx, func() {
		cancel()
		a.mu.Lock()
		if a.active == call {
			a.active = nil
		}
		a.mu.Unlock()
	}
}

// CancelTranscription 中断当前在途的转写或整理请求。界面在用户取消
// 这段录音时调用；没有在途请求时是空操作，可以重复调用。
func (a *App) CancelTranscription() error {
	a.mu.Lock()
	call := a.active
	a.active = nil
	a.mu.Unlock()
	if call != nil {
		call.cancel()
	}
	return nil
}

// AttachHistory 打开历史数据库。它接受路径而不是 *HistoryStore，
// 这样绑定生成器不会把内部存储类型暴露到 TypeScript；单独成一个
// 方法也不是塞进构造函数，是因为浏览器预览与部分测试根本没有
// 数据库可用，历史不可用不该阻止录音本身工作。
func (a *App) AttachHistory(path string) error {
	store, err := OpenHistoryStore(path)
	if err != nil {
		return err
	}
	a.mu.Lock()
	previous := a.history
	a.history = store
	a.mu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	return nil
}

// maybeReload 在每次读取配置的入口做一次 mtime 检查，让用户手改
// 配置文件后不必重启。解析失败只记录告警，保留内存里的旧配置。
func (a *App) maybeReload() {
	if a.store == nil {
		return
	}
	cfg, changed, err := a.store.LoadIfChanged()
	if err != nil {
		a.mu.Lock()
		a.configWarning = err.Error()
		a.mu.Unlock()
		return
	}
	if !changed {
		return
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	// 换个视角看：外部改动可能把模型删掉，而正在进行的调用仍拿着
	// 旧 provider 指针，因此这里重建整张表而不是只换配置。
	if err := a.rebuildProvidersForConfigLocked(cfg); err != nil {
		a.configWarning = err.Error()
		return
	}
	a.config = cfg
	a.configWarning = a.store.Warning()
}

// ConfigWarning 返回最近一次配置读取的问题，空字符串表示正常。
func (a *App) ConfigWarning() string {
	a.mu.RLock()
	defer a.mu.RUnlock()
	if a.configWarning != "" {
		return a.configWarning
	}
	if a.store != nil {
		return a.store.Warning()
	}
	return ""
}

// Config 返回当前设置的副本。Wails 会把它序列化到 JavaScript；
// API key 也包含在内，编辑表单才能原样回传。
func (a *App) Config() Config {
	a.maybeReload()
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.config
}

// GetConfig 是方便 Wails 绑定使用的别名。
func (a *App) GetConfig() Config { return a.Config() }

// GetDesktopConfig 返回浮动窗口、快捷键和输出行为设置面板所需的
// 桌面端专属偏好。
func (a *App) GetDesktopConfig() DesktopConfig {
	a.maybeReload()
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.config.Desktop
}

// SaveDesktopConfig 只更新桌面偏好，同时保留已配置的
// ASR 与 LLM 模型。
func (a *App) SaveDesktopConfig(cfg DesktopConfig) error {
	a.mu.Lock()
	defer a.mu.Unlock()
	// 设置面板不掌管浮动圆圈位置；面板回传的配置里没有坐标时
	// 保留已保存的坐标。
	if cfg.BubblePosition == nil {
		cfg.BubblePosition = a.config.Desktop.BubblePosition
	}
	updated := a.config
	updated.Desktop = cfg
	updated.applyDefaults()
	if err := updated.Validate(); err != nil {
		return err
	}
	if a.store == nil {
		return errors.New("config store is not configured")
	}
	if err := a.store.Save(updated); err != nil {
		return err
	}
	a.config = updated
	a.configWarning = a.store.Warning()
	return nil
}

func (a *App) SaveConfig(cfg Config) error {
	// 旧客户端只发送 ASR/LLM 字段。这种情况下保留桌面偏好，
	// 而不是悄悄把用户的窗口行为重置掉。
	a.mu.RLock()
	if strings.TrimSpace(cfg.Desktop.Hotkey) == "" && cfg.Desktop.HistoryRetentionDays == 0 {
		cfg.Desktop = a.config.Desktop
	}
	// 老客户端只发送 ASR/LLM 字段，JSON 里没有 presets（nil）；
	// 直接 applyDefaults 会把它当成空配置补回内置预设，从而清掉
	// 用户自己写的提示词。缺字段时沿用当前预设，显式空数组仍然报错。
	if cfg.LLM.Presets == nil {
		cfg.LLM.Presets = clonePolishPresets(a.config.LLM.Presets)
		cfg.LLM.ActivePresetID = a.config.LLM.ActivePresetID
	} else if len(cfg.LLM.Presets) == 0 {
		// 显式清空预设会让后续整理没有提示词可用；这里宁可报错，
		// 也不能悄悄用内置预设覆盖用户写过的内容。
		a.mu.RUnlock()
		return errors.New("at least one polish preset is required")
	}
	// 模型列表同理：nil 表示调用方没带这一块，不是要删光模型。
	if cfg.ASR.Models == nil {
		cfg.ASR.Models = cloneASRModels(a.config.ASR.Models)
		cfg.ASR.ActiveID = a.config.ASR.ActiveID
	}
	if cfg.LLM.Models == nil {
		cfg.LLM.Models = cloneLLMModels(a.config.LLM.Models)
		cfg.LLM.ActiveID = a.config.LLM.ActiveID
	}
	a.mu.RUnlock()
	cfg.applyDefaults()
	if err := cfg.Validate(); err != nil {
		return err
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if err := a.rebuildProvidersForConfigLocked(cfg); err != nil {
		return err
	}
	if a.store == nil {
		return errors.New("config store is not configured")
	}
	if err := a.store.Save(cfg); err != nil {
		return err
	}
	a.config = cfg
	a.configWarning = a.store.Warning()
	return nil
}

// TestProviders 只做轻量的服务商构建和 URL 校验，不发网络请求，
// 因此编辑设置时可以放心调用。报错会带上模型名，多模型时能
// 直接看出是哪一个配错了。
func (a *App) TestProviders(cfg Config) error {
	cfg.applyDefaults()
	if err := cfg.Validate(); err != nil {
		return err
	}
	for _, model := range cfg.ASR.Models {
		if _, err := NewOpenAICompatibleASR(providerConfig(model), a.httpClient); err != nil {
			return fmt.Errorf("asr %q: %w", model.Name, err)
		}
	}
	for _, model := range cfg.LLM.Models {
		if _, err := NewOpenAICompatibleLLM(model, a.httpClient); err != nil {
			return fmt.Errorf("llm %q: %w", model.Name, err)
		}
	}
	return nil
}

// providerConfig 把 API key 的 env: / file: 引用展开成实际密钥。
// 解析失败时把原值交给构造函数，让错误在真正调用时以服务商
// 报错的形式出现，而不是让整个模型池构建失败。
func providerConfig(model ASRConfig) ASRConfig {
	if key, err := ResolveSecret(model.APIKey); err == nil {
		model.APIKey = key
	}
	return model
}

func secretKey(raw string) string {
	if key, err := ResolveSecret(raw); err == nil {
		return key
	}
	return raw
}

func (a *App) rebuildProvidersLocked() error {
	return a.rebuildProvidersForConfigLocked(a.config)
}

// rebuildProvidersForConfigLocked 为每个模型各建一个 provider。
// 单个模型配置错误不应该让整个应用起不来，因此这里逐条构建，
// 失败的记进 configWarning，其余照常可用。
func (a *App) rebuildProvidersForConfigLocked(cfg Config) error {
	asr := make(map[string]ASRProvider, len(cfg.ASR.Models))
	llm := make(map[string]LLMProvider, len(cfg.LLM.Models))
	var problems []string
	for _, model := range cfg.ASR.Models {
		provider, err := NewOpenAICompatibleASR(providerConfig(model), a.httpClient)
		if err != nil {
			problems = append(problems, fmt.Sprintf("asr %q: %v", model.Name, err))
			continue
		}
		asr[model.ID] = provider
	}
	for _, model := range cfg.LLM.Models {
		keyed := model
		keyed.APIKey = secretKey(model.APIKey)
		provider, err := NewOpenAICompatibleLLM(keyed, a.httpClient)
		if err != nil {
			problems = append(problems, fmt.Sprintf("llm %q: %v", model.Name, err))
			continue
		}
		llm[model.ID] = provider
	}
	if len(asr) == 0 {
		return errors.New("no usable asr model is configured")
	}
	if len(llm) == 0 {
		return errors.New("no usable llm model is configured")
	}
	a.asr, a.llm = asr, llm
	if len(problems) > 0 {
		a.configWarning = strings.Join(problems, "; ")
	}
	return nil
}

// TranscribeAudio 用已配置的服务商执行语音转写。
func (a *App) TranscribeAudio(req AudioRequest) (TranscriptResult, error) {
	return a.transcribe(context.Background(), req)
}

func (a *App) transcribe(ctx context.Context, req AudioRequest) (TranscriptResult, error) {
	data, err := req.bytes()
	if err != nil {
		return TranscriptResult{}, err
	}
	a.maybeReload()
	a.mu.RLock()
	model, ok := a.config.ResolveASRModel(req.ModelID)
	provider := a.asr[model.ID]
	defaultLanguage := a.config.ASRLanguage(model)
	a.mu.RUnlock()
	if !ok || provider == nil {
		return TranscriptResult{}, errors.New("asr provider is not configured")
	}
	if req.Language == "" {
		req.Language = defaultLanguage
	}
	transcriptReq := TranscriptRequest{
		Audio:    data,
		Filename: req.Filename,
		MimeType: req.MimeType,
		Language: languageCode(req.Language),
		Prompt:   req.Prompt,
	}
	// 流式只影响结果怎么回来：音频仍然是这整一段，识别内容与非
	// 流式逐字相同，因此不必担心切分带来的歧义。
	pump := newPartialPump(nil)
	if model.Stream && model.NormalizedASRMode() == ASRModeChat {
		transcriptReq.Stream = true
		pump = newPartialPump(a.eventEmitter())
		transcriptReq.OnDelta = pump.push
	}
	runCtx, finishCall := a.beginCall(ctx)
	defer finishCall()
	result, err := provider.Transcribe(runCtx, transcriptReq)
	pump.done()
	if err != nil {
		a.appendCall(result.Call)
		return result, err
	}
	result.Text = strings.TrimSpace(result.Text)
	if result.Text == "" {
		emptyErr := noTextError("asr", result.Call)
		markFailed(&result.Call, emptyErr)
		a.appendCall(result.Call)
		return result, emptyErr
	}
	a.appendCall(result.Call)
	return result, nil
}

// PolishText 把文本交给已配置的整理模型。请求里的 presetId 为空或
// 已失效时回落到生效预设，因此界面上删掉的预设不会让调用失败。
// 返回的记录即使调用失败也描述这次调用，并带上所用预设的名称。
func (a *App) PolishText(req PolishRequestDTO) (PolishResult, error) {
	a.maybeReload()
	a.mu.RLock()
	preset, ok := a.config.ResolvePolishPreset(req.PresetID)
	model, modelOK := a.config.ResolveLLMModel(preset)
	provider := a.llm[model.ID]
	configuredPrompt := a.config.LLM.SystemPrompt
	a.mu.RUnlock()
	if !modelOK || provider == nil {
		return PolishResult{}, errors.New("llm provider is not configured")
	}
	polishReq := PolishRequest{Text: req.Text, Instructions: req.Instructions, Language: req.Language, ConfiguredPrompt: configuredPrompt}
	if ok {
		polishReq.SystemPrompt = preset.SystemPrompt
	}
	runCtx, finishCall := a.beginCall(context.Background())
	defer finishCall()
	result, err := provider.Polish(runCtx, polishReq)
	if ok {
		result.Call.Preset = preset.Name
	}
	result.Call.ModelID = model.ID
	a.appendCall(result.Call)
	return result, err
}

// SetActivePreset 切换当前生效的整理预设并立即落盘。界面切换选择器
// 时调用，记录页随后的整理请求还会再显式带上 presetId 兜一次。
func (a *App) SetActivePreset(id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("preset id is empty")
	}
	a.maybeReload()
	a.mu.Lock()
	defer a.mu.Unlock()
	updated := a.config
	updated.LLM.Presets = clonePolishPresets(a.config.LLM.Presets)
	if _, ok := updated.presetByID(id); !ok {
		return fmt.Errorf("polish preset %q does not exist", id)
	}
	updated.LLM.ActivePresetID = id
	if err := updated.Validate(); err != nil {
		return err
	}
	if a.store == nil {
		return errors.New("config store is not configured")
	}
	if err := a.store.Save(updated); err != nil {
		return err
	}
	a.config = updated
	return nil
}

// SetActiveModel 切换当前生效的模型。多模型的核心操作：录音用哪台
// ASR、默认整理用哪台 LLM，都在这里落盘。
func (a *App) SetActiveModel(kind, id string) error {
	id = strings.TrimSpace(id)
	if id == "" {
		return errors.New("model id is empty")
	}
	a.maybeReload()
	a.mu.Lock()
	defer a.mu.Unlock()
	updated := a.config
	switch strings.TrimSpace(kind) {
	case "asr":
		updated.ASR.Models = cloneASRModels(a.config.ASR.Models)
		if !containsASRModel(updated.ASR.Models, id) {
			return fmt.Errorf("asr model %q does not exist", id)
		}
		updated.ASR.ActiveID = id
	case "llm":
		updated.LLM.Models = cloneLLMModels(a.config.LLM.Models)
		if !containsLLMModel(updated.LLM.Models, id) {
			return fmt.Errorf("llm model %q does not exist", id)
		}
		updated.LLM.ActiveID = id
	default:
		return fmt.Errorf("unknown model kind %q", kind)
	}
	if err := updated.Validate(); err != nil {
		return err
	}
	if a.store == nil {
		return errors.New("config store is not configured")
	}
	if err := a.store.Save(updated); err != nil {
		return err
	}
	a.config = updated
	return nil
}

// ProcessAudio 先做语音转写，再按需做 LLM 整理。polish 默认为
// true，因为「先说、再整理」正是这个工具的主流程。
func (a *App) ProcessAudio(req AudioRequest, polish bool) (ProcessResult, error) {
	started := time.Now()
	result := ProcessResult{ID: fmt.Sprintf("%d", started.UnixNano()), StartedAt: started}
	transcript, err := a.transcribe(context.Background(), req)
	result.Calls = appendCallRecord(result.Calls, transcript.Call)
	if err != nil {
		result.Error = err.Error()
		result.FinishedAt = time.Now()
		result.DurationMS = result.FinishedAt.Sub(started).Milliseconds()
		return result, err
	}
	result.Transcript = transcript.Text
	result.PolishedText = transcript.Text
	if polish {
		clean, polishErr := a.PolishText(PolishRequestDTO{Text: transcript.Text, Language: req.Language, PresetID: req.PresetID})
		result.Calls = appendCallRecord(result.Calls, clean.Call)
		if polishErr != nil {
			result.Error = polishErr.Error()
			result.FinishedAt = time.Now()
			result.DurationMS = result.FinishedAt.Sub(started).Milliseconds()
			return result, polishErr
		}
		result.PolishedText = clean.Text
	}
	result.FinishedAt = time.Now()
	result.DurationMS = result.FinishedAt.Sub(started).Milliseconds()
	return result, nil
}

// StartRecording 开启一个内存中的录音会话。
// 真正的麦克风采集仍在前端（MediaRecorder）完成，
// 音频块通过 AppendRecordingChunk 送上来。
func (a *App) StartRecording(filename, mimeType, language, prompt string) (RecordingStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.recording != nil {
		return RecordingStatus{}, errors.New("a recording is already active")
	}
	now := time.Now()
	a.recording = &recording{id: fmt.Sprintf("%d", now.UnixNano()), startedAt: now, filename: filename, mimeType: mimeType, language: language, prompt: prompt}
	return a.recording.status(), nil
}

type AudioChunk struct {
	Data string `json:"data"`
}

type RecordingStatus struct {
	Active    bool      `json:"active"`
	ID        string    `json:"id,omitempty"`
	StartedAt time.Time `json:"startedAt,omitempty"`
	Bytes     int       `json:"bytes"`
}

func (r *recording) status() RecordingStatus {
	if r == nil {
		return RecordingStatus{}
	}
	return RecordingStatus{Active: true, ID: r.id, StartedAt: r.startedAt, Bytes: len(r.data)}
}

func (a *App) RecordingStatus() RecordingStatus {
	a.mu.RLock()
	defer a.mu.RUnlock()
	return a.recording.status()
}

// AppendRecordingChunk 把前端送来的音频块追加到当前会话。
func (a *App) AppendRecordingChunk(chunk AudioChunk) (RecordingStatus, error) {
	data, err := base64.StdEncoding.DecodeString(strings.TrimSpace(chunk.Data))
	if err != nil {
		return RecordingStatus{}, errors.New("audio chunk is not valid base64")
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.recording == nil {
		return RecordingStatus{}, errors.New("no active recording")
	}
	a.recording.data = append(a.recording.data, data...)
	return a.recording.status(), nil
}

// StopRecording 结束会话并把累积的音频交给同一条流水线。
func (a *App) StopRecording(polish bool) (ProcessResult, error) {
	a.mu.Lock()
	current := a.recording
	a.recording = nil
	a.mu.Unlock()
	if current == nil {
		return ProcessResult{}, errors.New("no active recording")
	}
	if len(current.data) == 0 {
		return ProcessResult{}, errors.New("recording is empty")
	}
	return a.ProcessAudio(AudioRequest{Data: base64.StdEncoding.EncodeToString(current.data), Filename: current.filename, MimeType: current.mimeType, Language: current.language, Prompt: current.prompt}, polish)
}

// CancelRecording 丢弃当前内存中的会话。桌面界面用浏览器
// MediaRecorder 采集，再把最终 blob 交给 TranscribeAudio，
// 因此这是该流程对应的清理操作。
func (a *App) CancelRecording() (RecordingStatus, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.recording == nil {
		return RecordingStatus{}, nil
	}
	a.recording = nil
	return RecordingStatus{}, nil
}

// ConfigPath 暴露当前使用的持久化路径，便于诊断。
func (a *App) ConfigPath() string {
	if a.store == nil {
		return ""
	}
	return a.store.Path()
}
