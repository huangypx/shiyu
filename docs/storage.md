# 本地存储

本文记录持久化的路径、格式与迁移约定。字段定义以 `backend/config.go`、`backend/history_store.go` 为准；改动这些结构时同步更新本文。

## 路径与权限

应用的文件持久化只有两处：

| 文件 | 内容 | 格式 |
| --- | --- | --- |
| `config.json` | 模型池、整理预设、桌面偏好、API key | 版本化 JSON |
| `history.db` | 语音记录与每条记录的调用明细 | SQLite 3 |

数据目录按以下顺序解析：

1. 环境变量 `SHIYU_HOME`（相对路径会展开成绝对路径）
2. `os.UserHomeDir()/.shiyu`
3. 两者都不可用时启动报错，不回退到当前工作目录

`~/.shiyu` 权限为 `0700`；`config.json`、`history.db`（含 `-wal`、`-shm`）为 `0600`。使用点目录是为了让配置便于手改和纳入 dotfiles；代价是 Finder 默认隐藏、部分备份工具会跳过。界面通过 `ConfigPath()` / `HistoryPath()` 展示真实路径。

## config.json

顶层是 `version: 2`。这里只列会影响行为的约定：

- `asr.models` / `llm.models`：模型池，至少一个；`id` 非空且唯一，改名不影响已产生历史。
- `asr.activeId` / `llm.activeId`：当前模型，缺失或失效时回落到列表第一个。
- `asr.language`：全局识别语言；单个模型的 `language` 非空时优先。
- `asr.models[].stream`：只对对话接口生效；默认 false，取默认值时不落盘，新增不需要升版本。
- `llm.presets` / `llm.activePresetId`：整理预设与当前预设；`presetId` 为空或失效时按「生效预设 → 第一个预设」回落，预设的 `modelId` 为空时使用 `llm.activeId`。
- `llm.systemPrompt`：兜底提示词，不随模型切换；提示词里的 `{{language}}` 会替换成当前识别语言。
- `desktop.hotkey`：平台默认值 macOS `Option+Space`、Windows `Alt+Space`、Linux `Ctrl+Shift+Space`；已保存的值不会被默认值覆盖。
- `desktop.historyRetentionDays`：0 表示永久保留；大于 0 时在启动阶段删除更早的记录。
- `desktop.bubbleHidden` / `desktop.closeAction`：分别只能通过 `Controller.SetBubbleHidden` 和 `Controller.ResolveClose` 写入；设置页保存其它偏好时会保留这两个字段，不会重置。Linux 没有托盘实现，不能持久化隐藏悬浮球。

### 凭证

`apiKey` 支持三种写法：

| 写法 | 含义 |
| --- | --- |
| `sk-...` | 明文写入配置文件（0600 保护） |
| `env:OPENAI_API_KEY` | 运行时从环境变量读取 |
| `file:/abs/path/to/key` | 运行时从文件读取并去掉首尾空白 |

`env:` / `file:` 解析失败不阻塞启动，`ConfigWarning()` 返回可读原因，真正发起调用时再报错。应用不会把 key 写入日志或历史。

### 写入与热重载

`ConfigStore.Save` 在目标目录写临时文件（0600）→ `fsync` → `os.Rename` 原子替换。应用运行期间手工修改配置文件，会在下一次读取配置时按 mtime 自动重载；解析失败时保留内存中的旧配置并暴露 `ConfigWarning()`，不会覆盖用户数据。

## history.db

SQLite 3，驱动为 `modernc.org/sqlite`（纯 Go，不需要 cgo）。连接开启 WAL、5 秒 busy timeout 和外键；`SetMaxOpenConns(1)`，桌面端写入频率低，单连接足以避免 `SQLITE_BUSY` 并让检查点行为更可预测。

- `records`：一条语音记录一行，`id` 与前端 Note 的 UUID 一致，`created_at` 为 RFC3339 UTC，保留期清理按它排序。
- `record_calls`：每条记录的调用明细，`record_id` 外键级联删除；`payload` 存 `CallRecord` 的 JSON，字段随服务商响应增长时无需迁移宽表。
- `schema_migrations`：记录已应用的结构版本。

录音流程结束（整理完成，或整理失败但转写成功）后写一条记录，调用明细随记录一起写入。启动时按 `desktop.historyRetentionDays` 执行一次清理（0 跳过），不做后台定时任务。历史库打不开时应用仍可用，只是历史页不可用。

## 不落盘的数据

| 数据 | 原因 |
| --- | --- |
| 录音音频 | 只在内存中流转，转写完成后丢弃 |
| 请求体 / 响应体原文 | 只保留耗时、token、状态码等结构化摘要 |
| API key 的解析结果 | 每次使用时重新解析 |
| 调用日志 | 只在本次运行的内存中，上限 200 条 |

## localStorage

桌面端不再把 localStorage 作为持久化：浏览器预览（没有 Wails runtime）用它兜底；桌面端仅保留外观与布局状态：

- `typeless-settings`、`typeless-desktop-settings`：预览环境的配置副本。
- `typeless-notes`：预览环境的历史；桌面端首次启动会导入 SQLite，成功后删除。
- `typeless-appearance`：外观偏好，桌面端也只存在 localStorage。
- `typeless-sidebar`、`typeless-record-split`：侧栏开合与记录页两栏比例，属于前端布局状态。
- key 名沿用改名前的 `typeless-*`，不要改名；改名会让已有预览数据消失。

## 迁移

- **配置 v1 → v2**：单模型 `asr` / `llm` 搬进各自模型池的 `models[0]`，`language` 提到 section 层，`desktop.resultHistoryLimit` 丢弃，`historyRetentionDays` 取 0，补 `version: 2`。
- **改名迁移**：旧数据目录 `~/.open-typeless` 在启动时整体搬到 `~/.shiyu`；判据是新目录为空且旧目录存在。同一文件系统用 `rename`，跨设备退化为复制并保留旧目录；新目录已有内容则跳过。
- **旧配置路径**：若新配置不存在，读取 `os.UserConfigDir()/open-typeless/config.json`，解码、补默认值后写入新路径；旧文件保留。
- **localStorage 历史**：桌面端首次启动把 `typeless-notes` 逐条导入 SQLite，按 `id` 幂等，全部成功后删除 key。

迁移失败只记日志、不阻止启动；旧数据保留，用户可在设置里重新填写。

## 诊断

- `ConfigPath()` / `HistoryPath()`：当前配置与数据库的绝对路径。
- `ConfigWarning()`：最近一次配置读取或热重载的告警，空字符串表示正常。
- `HistoryCount()`：记录总数。
