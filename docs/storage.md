# 本地存储

这份文档是本地持久化的唯一事实来源。任何新增字段、新增文件、改变路径的改动，都必须先更新这里，再改代码。

## 一、总览

应用只有两处持久化，都在 `~/.shiyu`：

| 文件 | 内容 | 格式 | 责任方 |
| --- | --- | --- | --- |
| `config.json` | 模型池、整理预设、桌面偏好、API Key | 版本化 JSON | Go（`backend/config.go`） |
| `history.db` | 语音记录与每条记录的调用明细 | SQLite 3 | Go（`backend/history_store.go`） |

目录与文件权限：

- 目录 `~/.shiyu`：`0700`
- `config.json`：`0600`
- `history.db`（含 `-wal`、`-shm`）：`0600`

### 路径解析顺序

1. 环境变量 `SHIYU_HOME`（测试、便携模式、dotfiles 用户使用）
2. `os.UserHomeDir()/.shiyu`
3. 两者都不可用时报错退出，**不回退到当前工作目录**，避免数据散落在启动目录里。

### 为什么不放在 `~/Library/Application Support`

macOS 的惯例是 `~/Library/Application Support/<bundle-id>`。这里改用家目录下的点目录，是为了让配置文件一眼可见、方便手改和纳入 dotfiles。代价必须明确：

- Finder 默认隐藏以 `.` 开头的目录；
- 部分备份工具默认跳过点目录；
- 需要用户自己知道它在哪。

因此 `ConfigPath()` 与 `HistoryPath()` 会通过 Wails 暴露真实路径，界面可以展示给用户。

Windows 上 WebView2 的数据目录可以用 `Windows.WebviewUserDataPath` 一并收进同一目录；macOS / Linux 的 WebKit 数据目录无法重定向，保持系统默认。

## 二、config.json

### 顶层结构

```json
{
  "version": 2,
  "asr": {
    "activeId": "default",
    "language": "中文（普通话）",
    "models": [
      {
        "id": "default",
        "name": "默认模型",
        "provider": "openai-compatible",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "",
        "model": "gpt-4o-mini-transcribe",
        "language": "",
        "mode": "transcriptions",
        "stream": false
      }
    ]
  },
  "llm": {
    "activeId": "default",
    "systemPrompt": "",
    "models": [
      {
        "id": "default",
        "name": "默认模型",
        "provider": "openai-compatible",
        "baseUrl": "https://api.openai.com/v1",
        "apiKey": "",
        "model": "gpt-4o-mini",
        "temperature": 0.2
      }
    ],
    "presets": [
      {
        "id": "default",
        "name": "默认整理",
        "systemPrompt": "……",
        "modelId": ""
      }
    ],
    "activePresetId": "default"
  },
  "desktop": {
    "hotkey": "Ctrl+Shift+Space",
    "autoPaste": true,
    "startInBubble": false,
    "keepBubbleOnTop": true,
    "showResultPreview": true,
    "restoreClipboard": true,
    "historyRetentionDays": 0,
    "bubblePosition": { "x": 0, "y": 0 }
  }
}
```

### 字段约定

- `version`：schema 版本。当前为 `2`。未知版本拒绝启动并提示备份，不做猜测性解析。
- `asr.models` / `llm.models`：模型池。至少一个；`id` 非空且唯一，是引用其他字段的稳定标识，改名不影响已产生的历史。
- `asr.activeId` / `llm.activeId`：全局当前模型。缺失或指向不存在的 ID 时回落到列表第一个。
- `asr.language`：全局识别语言。单个模型的 `language` 非空时优先。
- `asr.models[].stream`：是否让服务商以 SSE 边生成边返回转写文字。只有 `mode: "chat"` 时生效，其它模式忽略。默认 `false`，取默认值时整个键不落盘（`omitempty`），因此旧配置读到的内容与升级前完全一致；**新增该字段不需要升 `version`**。
- `llm.systemPrompt`：整理提示词的兜底值，不随模型切换。
- `presets[].modelId`：预设可绑定某个 LLM 模型；为空表示跟随 `llm.activeId`。绑定的 ID 失效时同样回落到 `activeId`。
- `desktop.historyRetentionDays`：`0` 表示永久保留；大于 0 时在启动阶段删除更早的记录。

### 凭证

`apiKey` 支持三种取值：

| 写法 | 含义 |
| --- | --- |
| `sk-...` | 直接把密钥写进文件（文件权限 0600 保护） |
| `env:OPENAI_API_KEY` | 运行时从环境变量读取 |
| `file:/abs/path/to/key` | 运行时从文件读取并去掉首尾空白 |

`env:` 与 `file:` 解析失败不会阻塞启动：配置照常加载，`ConfigWarning()` 返回可读原因，真正发起调用时再报错。

### 写入方式

`ConfigStore.Save` 在目标目录内写临时文件（`.config-*.tmp`，0600）→ `fsync` → `os.Rename` 原子替换。进程中断不会留下写了一半的配置。

### 手工编辑

- 应用运行期间修改该文件，会在下一次读取配置的入口（`GetConfig` / `GetDesktopConfig` / 转写 / 整理 / 切换预设）按 `mtime` 检测并自动重载，无需重启。
- 文件解析失败时保留内存中的旧配置，并用 `ConfigWarning()` 暴露原因，不会因为一次半保存的文件让应用崩溃或覆盖掉用户数据。
- 设置页保存后同样写这个文件，两边不会互相覆盖。

## 三、history.db

### 连接参数

```
file:<path>?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)
```

驱动为 `modernc.org/sqlite`（纯 Go，不需要 cgo）。选它的原因：Windows 交叉编译不能依赖 cgo，`mattn/go-sqlite3` 需要 CGO。代价是二进制约增大 10–15 MB、首次编译更慢。

`SetMaxOpenConns(1)`：桌面应用的写入频率很低，单连接足以避免 `SQLITE_BUSY`，也让 WAL 检查点行为更可预测。

### 表结构

```sql
CREATE TABLE schema_migrations (
  version    INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE records (
  id           TEXT PRIMARY KEY,        -- 与前端 Note.id 一致（UUID）
  created_at   TEXT NOT NULL,           -- RFC3339 UTC，排序与保留期清理都靠它
  title        TEXT NOT NULL,
  preview      TEXT NOT NULL,
  transcript   TEXT NOT NULL,
  organized    TEXT NOT NULL DEFAULT '',
  language     TEXT NOT NULL DEFAULT '',
  preset_id    TEXT NOT NULL DEFAULT '',
  preset_name  TEXT NOT NULL DEFAULT '',-- 记录当时的预设名，之后改名不回溯
  asr_model_id TEXT NOT NULL DEFAULT '',
  llm_model_id TEXT NOT NULL DEFAULT '',
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  error        TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_records_created_at ON records(created_at DESC);

CREATE TABLE record_calls (
  id        TEXT PRIMARY KEY,
  record_id TEXT NOT NULL REFERENCES records(id) ON DELETE CASCADE,
  kind      TEXT NOT NULL,              -- 'asr' | 'llm'
  payload   TEXT NOT NULL               -- CallRecord 的 JSON
);
CREATE INDEX idx_record_calls_record ON record_calls(record_id);
```

调用明细用 JSON 列而不是宽表：`CallRecord` 会随服务商响应字段增长，宽表每加一个字段都要迁移一次；查询模式只有「按记录取明细」，JSON 足够。

### 写入时机

录音流程结束（自动整理完成，或整理失败但转写成功）时写一条记录，调用明细随记录一起写入。写入由前端在拿到最终文本后发起，标题与预览按现有规则在调用方生成；后端在为空时兜底派生。

### 保留期

启动时执行一次 `Prune(now - historyRetentionDays)`；`0` 跳过。不做后台定时任务，桌面进程寿命短，启动跑一次足够。

## 四、明确不落盘的数据

| 数据 | 原因 |
| --- | --- |
| 录音音频 | 只在内存中流转，转写完成后即丢弃 |
| 请求体 / 响应体原文 | 只保留耗时、token、状态码等结构化摘要 |
| API Key 的解析结果 | 每次使用时从配置或环境变量重新解析 |
| 调用日志（`App.calls`） | 仅本次运行，上限 200 条 |

## 五、localStorage 的定位

桌面端已不再把 localStorage 当作持久化：

- `typeless-settings`、`typeless-desktop-settings`、`typeless-notes` 只在**浏览器预览**（没有 Wails 运行时）中作为兜底；
- `typeless-appearance` 仍然只在 localStorage，属于唯一的前端专属偏好；
- 首次在桌面端启动时，若检测到旧的 `typeless-notes`，会一次性导入 SQLite，导入成功后删除该 key；迁移到的条数记录在日志里。

浏览器预览没有后端，历史写入 localStorage，行为与改造前一致。

## 六、迁移

### 配置 v1 → v2

旧结构为单模型（`asr` / `llm` 直接是端点字段）。加载到 `version` 缺失或为 1 的文件时：

1. 把 `asr` 整体搬成 `asr.models[0]`，补 `id: "default"`、`name: "默认模型"`；
2. `llm` 同理搬进 `llm.models[0]`，`temperature` 随模型走，`systemPrompt` 提到 section；
3. `asr.language` 提到 section 层，模型内的同名字段清空；
4. `desktop.resultHistoryLimit` 丢弃，`historyRetentionDays` 取 `0`；
5. 补 `version: 2`。

原有的「旧 `systemPrompt` → 我的整理预设」迁移逻辑保持不变。

### 改名迁移

应用原名 Open Typeless，数据目录随之从 `~/.open-typeless` 换成 `~/.shiyu`。启动时
（在建目录之前）做一次搬迁，判据是「新目录为空、旧目录存在」：

- 同一文件系统上直接 `rename`，配置与历史一次性整体到位；
- 跨设备时 `rename` 失败，退化成逐文件复制，旧目录原样保留；
- 新目录已有内容就跳过，绝不覆盖。

搬迁失败只记日志、不阻止启动；用户仍可在设置里重新填写。旧目录里的
`config.json`、`history.db` 确认无误后可手工删除。

### 旧配置路径迁移

若 `~/.shiyu/config.json` 不存在，而 `os.UserConfigDir()/open-typeless/config.json` 存在，
则读取旧文件、走上面的迁移、写入新路径。旧文件原样保留，确认无误后可手工删除。

### localStorage 历史迁移

首次启动时读取 `typeless-notes`，逐条导入 `history.db`（`id` 已存在则跳过，保证幂等），全部成功后删除该 key。旧数据的 `time` 字段是写死的「刚刚」，导入时按 `Note.id`（毫秒时间戳）还原成真实时间。

## 七、诊断

- `ConfigPath()`：当前配置文件绝对路径
- `HistoryPath()`：当前数据库绝对路径
- `ConfigWarning()`：最近一次配置读取或热重载的告警，空字符串表示正常
- `HistoryCount()`：记录总数
