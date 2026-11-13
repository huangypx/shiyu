# Shiyu / 拾语

拾语是一个桌面语音输入与文字整理工具。它用 ASR 模型转写语音，再用 OpenAI 兼容的聊天模型整理文字。模型配置和历史记录保存在本机。主窗口、悬浮球和偏好设置默认使用「青瓷绿 × 朱红」，也可在「偏好设置 → 桌面行为」中切换为「经典黑白」或「深梅紫 × 杏桃」。

## 功能

- 一键开始/结束录音，支持浏览器预览和 Wails 桌面端。
- 多模型：ASR 与 LLM 各自维护一个模型池，可以同时配置便宜模型与强模型，随时切换当前使用的那一台；整理预设还能单独绑定某个 LLM 模型。
- ASR 与 LLM 分开配置：服务商、模型、接口地址、API key 和语言都可以独立设置。
- 默认使用 OpenAI-compatible API，也可填写 Groq、Ollama 或自建网关的地址。
- 整理预设可自定义：内置「默认整理」「精简去重」「Markdown 结构」「会议纪要」四套系统提示词，可新建、复制、编辑并随时切换。
- 记录页左侧可编辑转写原文，右侧显示整理结果。点结果旁的复制图标即可复制全文。
- 历史记录存在本机的 SQLite 数据库里：真实时间戳、可删除单条、可清空、可按保留期自动清理；另有自动保存与无模型连接时的浏览器演示回退数据。
- 桌面浮动圆圈、全局快捷键、自动粘贴到当前光标，以及可展开的结果历史。
- 主窗口标题栏显示拾语标记与平台窗口按钮，下方工具栏提供录音、新建、历史和设置。悬浮球的无边框窗口随内容调整大小。
- Go 后端按配置、provider、service、handlers、history 拆分，前端按组件、服务和类型拆分；本地存储的完整约定见 [`docs/storage.md`](docs/storage.md)。

## 开发环境

- Go 1.26+
- Node.js 20+
- Wails v3.1+
- Linux 桌面构建还需要 GTK 3、WebKitGTK 4.0 或 4.1 的开发包；macOS/Windows 使用 Wails 对应的系统依赖。Wails v3 对 WebKitGTK 4.1 使用 `webkit2_41` 构建标签，Makefile 会在检测到 4.1 时自动启用。
- macOS 的透明浮动球需要 Wails 的 `private_mac_apis` 私有 API 构建标签；因此只适合直接分发，不能提交 App Store。

```bash
git clone <your-fork>
cd shiyu
cd frontend && npm install && npm run build
cd ..
go test ./...
```

开发前端预览（只有网页，不启动 Wails 窗口）：

```bash
cd frontend
npm run dev
```

桌面开发模式（首次运行会**自动把固定版本的 wails3 装到 .bin**，不需要全局安装）：

```bash
make dev
```

如果已经全局安装 Wails v3 CLI，也可以直接运行 `wails3 dev`。注意 `wails` 是 v2 CLI，不能用。

前端使用 React 18 + React Router（hash 路由）+ Radix Themes，状态按业务能力拆成 zustand store，样式为 CSS Modules。提交前跑一次完整自查：

```bash
cd frontend && npm run check      # eslint + prettier + tsc + vitest + build
```

也可以单独执行 `npm run lint`、`npm run format`、`npm run typecheck`、`npm run test`。目录划分、路由与状态约定见 [`docs/frontend-architecture.md`](docs/frontend-architecture.md)。

视觉验收基线见 [`docs/visual-baseline.md`](docs/visual-baseline.md)，参考截图统一放在 [`docs/visual-baseline/`](docs/visual-baseline/)。安装 Chromium 后可以生成桌面和移动端参考截图：

```bash
cd frontend
./scripts/capture-visual-baseline.sh
```

构建桌面应用（需要 Wails v3 CLI、Go 1.26 和系统 WebKit 依赖）：

```bash
make build
```

macOS 上 Makefile 会自动追加 `private_mac_apis`；其他平台不要带这个标签。Ubuntu 26.04 等只提供 WebKitGTK 4.1 的系统由 Makefile 自动追加 `webkit2_41`。也可以直接调用 CLI：

```bash
wails3 build -tags private_mac_apis   # macOS
wails3 build -tags webkit2_41         # Linux + WebKitGTK 4.1
```

未安装全局 CLI 时可以用 `go run github.com/wailsapp/wails/v3/cmd/wails3@v3.1.0` 代替 `wails3`。重新生成 TypeScript bindings：

```bash
make bindings
```

## 模型配置

在“偏好设置”中分别填写 ASR 和 LLM。接口地址可以填写 provider 根地址（例如 `https://api.openai.com/v1`），也可以直接填写完整的 `/audio/transcriptions` 地址。后端会自动补齐 OpenAI-compatible 路径。

默认语音识别模型为 `gpt-transcribe`。在「偏好设置 → 语音识别」选「中文（普通话）」会发送 `languages[]=zh`，选「自动识别」时省略语言提示。模型单独设置的语言优先于全局识别语言。[OpenAI 文件转写指南](https://developers.openai.com/api/docs/guides/speech-to-text)

ASR 有两种接口类型：

| 接口类型 | 请求 | 适用 |
| --- | --- | --- |
| 转写接口（默认） | multipart 上传到 `/audio/transcriptions` | OpenAI、Groq、whisper.cpp 等 Whisper 兼容服务 |
| 对话接口 | JSON 上传到 `/chat/completions`，音频作为 `input_audio` 片段 | mimo-v2.5-asr 等多模态语音模型 |

转写接口返回 `{ "text": "..." }`，对话接口读取 `choices[0].message.content`。对话接口只接受 wav / mp3，因此应用统一用 Web Audio 采集并写出 16kHz 单声道 WAV（`MediaRecorder` 在 Chromium 上只能出 webm、在 WKWebView 上只能出 mp4，都不被这类接口接受）。

### 流式返回

对话接口支持在请求体里带 `stream: true`，服务商随后用 SSE 逐块返回 `choices[0].delta.content`（小米 MiMo 的 `mimo-v2.5-asr` 就是这种）。应用把它做成每个模型一个开关（`asr.models[].stream`，默认关闭），原因有两个：不同网关对 `stream` 的支持并不一致，而且它只在对话接口下生效。

这里要分清两件事：

- 启用流式返回时，客户端仍在录音结束后一次上传音频，识别出的文字逐步显示在「原文」栏。
- **它不是「边说边出字」。** 那需要流式**输入**（边录边把音频增量传上去，或 WebSocket 双向流），小米目前没有开放这类接口。靠本地切分音频去换实时性会让识别结果随切点大幅波动，应用不做这件事。

网关如果直接忽略 `stream`、回一份普通 JSON，客户端会照常解析，效果等同于关闭流式。

LLM 需要返回 Chat Completions 格式的 `choices[0].message.content`。本地 Ollama 可将 LLM 地址设为 `http://127.0.0.1:11434/v1`，API key 留空。

### 整理预设

「每一次整理」本质上是让 LLM 按一段系统提示词重写文本。偏好设置里的「整理预设」把这段提示词交给用户维护：每个预设是「名称 + 系统提示词」，可以新建、复制、编辑、删除，并选一个作为当前预设。

- 当前预设对整条流程生效：录音结束后的自动整理、记录页的「整理文字」、浮动球与全局快捷键都使用它。
- 切换整理预设只影响下一次整理，已有结果保留。
- 每次 LLM 调用都会在调用概要条、调用详情、调用记录与历史记录里标注所用预设的名称。
- 提示词里写 `{{language}}` 会替换成当前识别语言；不写时后端仍会在末尾补一句语言要求，与旧版本行为一致。
- 内置预设会把口述中的步骤和优先级整理为编号列表，把并列事项逐行列出，省去重复、铺垫和额外的总结。普通叙述保留为段落。
- 升级时只更新仍使用出厂提示词的内置预设。早期版本手改过的 `systemPrompt` 会迁移为「我的整理」预设并设为当前。
- 预设至少保留一个，最多 24 个；名称不超过 60 字，提示词不超过 8000 字节。

macOS 首次录音会请求麦克风权限；首次自动粘贴会请求“控制 System Events”的自动化权限，拒绝后仍会把结果留在剪贴板。

API key 只写入 `~/.shiyu/config.json`（目录 0700、文件 0600），保存时使用临时文件原子替换。也可以写成 `env:OPENAI_API_KEY` 或 `file:/绝对路径`，把明文密钥留在配置文件之外。应用不会把 key 写入日志或历史记录。

应用运行时手工修改这个文件会被自动检测并重载，不必重启；文件写坏时保留内存里的旧配置，只在界面上提示原因。

## 调用详情

界面上能看到每次模型调用的细节，不必去翻日志：

- 在调用记录中可以查看接口类型、模型、音频时长、耗时、实时倍率和 token 用量。
- 工具栏「更多操作 → 调用记录」列出本次会话的调用及失败原因，可查看汇总或清空记录。
- 历史记录里的每条结果都带上了自己的调用明细，重新打开仍可查看。

这些数字来自 provider 的响应，不是估算：

| 字段 | 来源 |
| --- | --- |
| 耗时 | 从发出请求到读完响应体 |
| 入 / 出 token | 响应 `usage` 的 `prompt_tokens` / `completion_tokens`，同样兼容 `input_tokens` / `output_tokens` |
| 音频 / 缓存 / 思考 tokens | `usage` 里的 details 字段，有则显示 |
| 音频时长、实时倍率 | 本地解析 WAV 头，配合耗时算几倍速 |
| 服务端耗时 | 响应里的 `elapsed_ms`（部分网关会返回） |
| 状态码、错误 | HTTP 状态与响应体摘要，失败调用同样记录 |

调用记录只存在内存里，最多 200 条，且仅限本次运行；应用不会把音频、完整请求体或响应体、API key 写进记录。

## 桌面交互

完整的状态流和交互取舍见 [`docs/desktop-interaction.md`](docs/desktop-interaction.md)。

主窗口标题栏左侧显示拾语标记，macOS 保留原生交通灯，Windows 和 Linux 可双击标题栏最大化或还原。手动收起后再打开，主窗口会恢复先前的位置和大小。

切到其他软件、最小化主窗口或选择「更多操作 → 收进悬浮球」，拾语会转入后台。空闲时悬浮球隐藏。录音和整理期间悬浮球持续显示，通知和结果出现 5 秒后自动收起。Windows 任务栏不显示拾语窗口，点击系统托盘里的拾语图标可打开主窗口。

Windows 默认轻按并松开 **右 Alt** 开始录音，再轻按一次结束。后台启动后即可使用，可在「偏好设置 → 桌面行为 → 开始 / 结束录音快捷键」更换。macOS 和 Linux 默认使用 `Ctrl+Shift+Space`。后台录音时，悬浮球展开为横向波形胶囊。整理完成后原位显示全文，点击复制图标即可复制。开启自动粘贴时，原输入框仍有焦点也会收到结果。

关闭窗口时可选「后台运行」或「直接退出」。勾选「记住本次选择，以后不再询问」后，下次关闭会沿用该选择，可在「偏好设置 → 桌面行为 → 关闭窗口时」改回「每次询问」。后台运行时可通过托盘图标打开主窗口或退出拾语。

主窗口的「历史记录」会保存前台和后台录音产生的文本。展开一条记录可查看完整整理结果和转写原文，也可以复制结果。

Windows 用户可在「偏好设置 → 桌面行为」开启「开机启动」，登录后拾语会自动在后台运行。

## 项目结构

```text
backend/
  config.go       配置加载与原子写盘（schema v2）
  config_model.go 默认值、v1 迁移、凭证解析与校验
  paths.go        ~/.shiyu 解析与目录权限
  migrate.go      旧路径配置的一次性迁移
  providers.go    ASR/LLM 接口及 OpenAI-compatible HTTP 客户端
  service.go      Wails 服务、模型池、录音会话和处理流程
  stream.go       转写增量事件（asr:partial）与节流推送
  handlers.go     JSON/base64 DTO
  history.go      有界内存的调用日志
  history_store.go SQLite 历史存储
  history_api.go  历史相关的 Wails 方法
  metrics.go      每次调用的耗时、token 与状态码
  *_test.go       provider、配置、迁移、历史与流程测试
desktop/
  controller.go   主窗口/浮动球的尺寸、位置、置顶和 Wails 事件
  menu.go         悬浮球的原生右键菜单与系统托盘入口
  app_options.go  Wails v3 窗口选项与平台差异
  chrome_darwin.go macOS 交通灯、borderless 与阴影切换（cgo）
  chrome_windows.go Windows 窗口边框与悬浮球焦点处理
  chrome_*.go     无原生 chrome 平台的回退实现
  hotkey.go       全局快捷键注册与注销
  injector.go     Linux/macOS/Windows 粘贴按键适配
frontend/bindings/  Wails v3 CLI 生成的 TypeScript 绑定（提交到仓库）
build/              Wails v3 构建配置、图标和各平台打包资源（图标 SVG 源在 build/icons/）
Taskfile.yml        Wails v3 构建任务入口
frontend/
  src/app/        入口、路由表、标题栏、工具栏与外观主题
  src/pages/      路由页面：记录、历史、调用记录
  src/features/   录音、转写、历史、调用、设置、桌面各业务模块与 store
  src/services/   Wails binding 适配、录音采集、平台检测、localStorage 兜底
  src/styles/     global.css（reset 与平台变量）、theme.css（设计 token）
  src/types/      领域模型与默认值；src/mocks/ 放浏览器预览的演示数据
main.go           Wails 应用入口和嵌入式静态资源
```
