# backend

`backend` 包含面向 Wails 的服务与 provider 客户端。它刻意不依赖 Wails runtime，
因此可以当作普通 Go 包测试，并由 Wails 的 `main` 应用绑定：

```go
paths, err := backend.DefaultPaths() // ~/.shiyu
app, err := backend.NewApp(paths.ConfigPath)
app.AttachHistory(paths.HistoryPath) // 打不开时应用仍可用，只是历史不可用
// application.Options{Services: []application.Service{application.NewService(app)}}
```

本地存储的完整约定见 [`docs/storage.md`](../docs/storage.md)：配置在
`~/.shiyu/config.json`，历史在 `~/.shiyu/history.db`。

## 配置

配置是版本化的 JSON（当前 `version: 2`），结构分三块：

- `asr.models` / `llm.models`：模型池，各自至少一个，`id` 唯一且稳定；
- `asr.activeId` / `llm.activeId`：当前使用的模型，失效时回落到列表第一个；
- `llm.presets`：整理预设，`presets[].modelId` 可绑定某个 LLM 模型，
  为空表示跟随 `llm.activeId`。

默认都使用 OpenAI 兼容端点：

- ASR：`POST {baseUrl}/audio/transcriptions`（multipart 的 `file` 与 `model`），
  或把 `mode` 设为 `chat` 走 `POST {baseUrl}/chat/completions` 的 `input_audio`；
- LLM：`POST {baseUrl}/chat/completions`，system 与 user 消息。

`apiKey` 支持 `env:NAME` 与 `file:/abs/path` 两种间接引用，解析失败不阻塞启动，
只在 `ConfigWarning()` 里报告。配置文件由 `ConfigStore` 原子替换写入（0600），并在
每次读取配置的入口按 mtime 检测外部修改，因此手工编辑后不必重启。

桌面行为通过 `GetDesktopConfig` 和 `SaveDesktopConfig` 单独保存，包含全局快捷键、
浮动窗口默认值、自动粘贴偏好、剪贴板还原和历史保留期。

## 多模型

`SetActiveModel(kind, id)` 切换当前 ASR / LLM 模型并立即落盘；`kind` 取 `asr` 或
`llm`。`PolishText` 的 `presetId` 为空或已失效时，按「生效预设 → 列表第一个」回落，
再按 `preset.modelId` 选模型，没有绑定才用 `llm.activeId`。`llm.systemPrompt` 是
兜底提示词，不随模型切换；旧配置缺少 presets 时，非默认的 systemPrompt 会被迁移成
「我的整理」预设。

## 历史

历史记录走 SQLite（`modernc.org/sqlite`，纯 Go、不需要 cgo）：

- `SaveHistory` / `ListHistory` / `GetHistory` / `DeleteHistory` / `ClearHistory`
- `HistoryCount` / `HistoryPath` 供界面展示与诊断
- `ImportHistory` 把旧版 localStorage 记录一次性迁移进库（按 id 幂等）
- `PruneHistory(days)` 在启动时清理超出保留期的记录，`days <= 0` 表示永久保留

调用日志（`RecentCalls` / `ClearCalls`）仍然只存在内存里，上限 200 条，仅本次运行。

## 录音

浏览器录音端把 `AudioRequest.Data` 和 `AudioChunk.Data` 以 base64 发送。
一次性请求用 `ProcessAudio`；增量流程是 `StartRecording`、
`AppendRecordingChunk` 和 `StopRecording`。
