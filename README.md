# Shiyu / 拾语

一个面向桌面的开源语音输入与文字整理工具。它把语音输入的核心工作流拆成两个可替换的模型服务：浏览器 `MediaRecorder` 捕获语音，ASR 服务转写，OpenAI-compatible 的聊天模型负责整理、提炼和补全标点。配置和历史记录保存在本机，界面使用中性灰画布与石墨主色，跟随系统的浅色/深色外观，主窗口使用各平台原生窗口层（macOS 交通灯与透明标题栏，Windows 11/Linux 无边框自绘标题栏），画布与视觉由 CSS 负责。

## 功能

- 一键开始/结束录音，支持浏览器预览和 Wails 桌面端。
- 多模型：ASR 与 LLM 各自维护一个模型池，可以同时配置便宜模型与强模型，随时切换当前使用的那一台；整理预设还能单独绑定某个 LLM 模型。
- ASR 与 LLM 分开配置：服务商、模型、接口地址、API key 和语言都可以独立设置。
- 默认使用 OpenAI-compatible API，也可填写 Groq、Ollama 或自建网关的地址。
- 整理预设可自定义：内置「默认整理」「精简去重」「Markdown 结构」「会议纪要」四套系统提示词，可新建、复制、编辑并随时切换。
- 记录页是一张双面卡片：原文直接可编辑，整理完成时卡片自动翻到整理结果，两面都能手动翻看，结果支持复制。
- 历史记录存在本机的 SQLite 数据库里：真实时间戳、可删除单条、可清空、可按保留期自动清理；另有自动保存与无模型连接时的浏览器演示回退数据。
- 桌面浮动圆圈、全局快捷键、自动粘贴到当前光标，以及可展开的结果历史。
- 原生窗口层：macOS 使用系统交通灯和透明标题栏；Windows 11/Linux 把最小化/最大化/关闭画进同一条 36px 应用顶带，全平台只有一行标题；浮动模式会自动切成 borderless 92×126 窗口（顶部 92×92 是球，底部 34px 留给悬停工具栏）。
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

ASR 有两种接口类型：

| 接口类型 | 请求 | 适用 |
| --- | --- | --- |
| 转写接口（默认） | multipart 上传到 `/audio/transcriptions` | OpenAI、Groq、whisper.cpp 等 Whisper 兼容服务 |
| 对话接口 | JSON 上传到 `/chat/completions`，音频作为 `input_audio` 片段 | mimo-v2.5-asr 等多模态语音模型 |

转写接口返回 `{ "text": "..." }`，对话接口读取 `choices[0].message.content`。对话接口只接受 wav / mp3，因此应用统一用 Web Audio 采集并写出 16kHz 单声道 WAV（`MediaRecorder` 在 Chromium 上只能出 webm、在 WKWebView 上只能出 mp4，都不被这类接口接受）。

### 流式返回

对话接口支持在请求体里带 `stream: true`，服务商随后用 SSE 逐块返回 `choices[0].delta.content`（小米 MiMo 的 `mimo-v2.5-asr` 就是这种）。应用把它做成每个模型一个开关（`asr.models[].stream`，默认关闭），原因有两个：不同网关对 `stream` 的支持并不一致，而且它只在对话接口下生效。

这里要分清两件事：

- **流式的是结果，不是音频。** 录音结束后仍然是**整段**音频上传一次，识别内容与关闭流式时逐字相同；不同的是文字会边生成边显示在记录卡的「原始记录」一面上，而不是等整段结果一次性出现。
- **它不是「边说边出字」。** 那需要流式**输入**（边录边把音频增量传上去，或 WebSocket 双向流），小米目前没有开放这类接口。靠本地切分音频去换实时性会让识别结果随切点大幅波动，应用不做这件事。

网关如果直接忽略 `stream`、回一份普通 JSON，客户端会照常解析，效果等同于关闭流式。

LLM 需要返回 Chat Completions 格式的 `choices[0].message.content`。本地 Ollama 可将 LLM 地址设为 `http://127.0.0.1:11434/v1`，API key 留空。

### 整理预设

「每一次整理」本质上是让 LLM 按一段系统提示词重写文本。偏好设置里的「整理预设」把这段提示词交给用户维护：每个预设是「名称 + 系统提示词」，可以新建、复制、编辑、删除，并选一个作为当前预设。

- 当前预设对整条流程生效：录音结束后的自动整理、记录页的「整理文字」、浮动球与全局快捷键都使用它。
- 记录卡两面的底栏都可以直接切换预设；切换只影响下一次整理，已有结果保留，方便对比同一段话的不同风格。
- 每次 LLM 调用都会在调用概要条、调用详情、调用记录与历史记录里标注所用预设的名称。
- 提示词里写 `{{language}}` 会替换成当前识别语言；不写时后端仍会在末尾补一句语言要求，与旧版本行为一致。
- 内置「默认整理」与旧版本写死的提示词完全一致，升级后默认行为不变。旧版本如果手改过 `systemPrompt`，升级时会变成名为「我的整理」的预设并设为当前。
- 预设至少保留一个，最多 24 个；名称不超过 60 字，提示词不超过 8000 字节。

macOS 首次录音会请求麦克风权限；首次自动粘贴会请求“控制 System Events”的自动化权限，拒绝后仍会把结果留在剪贴板。

API key 只写入 `~/.shiyu/config.json`（目录 0700、文件 0600），保存时使用临时文件原子替换。也可以写成 `env:OPENAI_API_KEY` 或 `file:/绝对路径`，把明文密钥留在配置文件之外。应用不会把 key 写入日志或历史记录。

应用运行时手工修改这个文件会被自动检测并重载，不必重启；文件写坏时保留内存里的旧配置，只在界面上提示原因。

## 调用详情

界面上能看到每次模型调用的细节，不必去翻日志：

- 录音结束后，记录卡的两面各有一条概要：接口类型、模型、音频时长、耗时、实时倍率和 token 用量，点「详情」展开完整记录。
- 侧栏「调用记录」列出本次会话的每一次调用，包括失败的那几次，并汇总成功数、失败数、总耗时和总 token，可一键清空。
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

主窗口的窗口层使用平台原生能力：macOS 保留真实交通灯和透明标题栏，Windows 11/Linux 使用无边框窗口，并把窗口按钮并入 36px 的应用顶带，因此全平台都只有一行标题。网页内容仍是 HTML/CSS，画布由 AppShell 绘制；Wails 不会把按钮变成 NSButton 或 Win32 控件。窗口是原生的，标题带和视觉层仍由 React 绘制。

桌面端主窗口右上角的斜向箭头会把窗口收成一个保持置顶的浮动圆圈。圆圈本身就是完整的拖拽手柄，可以随手拖到屏幕任意位置，位置会记住并在下次启动时还原；单击立即开始或结束录音，鼠标悬停时圆圈下方淡出操作按钮：待录音时是展开主窗口和打开偏好设置；开始录音后只保留取消这段转写，必须结束或取消当前录音才能展开/设置；指针落在图标上时按钮底色反转，深色主题下就是黑底白图标；右键保留系统原生菜单，只放隐藏悬浮球和退出拾语。macOS 的 WebKit 默认只在窗口获得焦点时更新 hover，`desktop/hover_darwin.go` 用 `NSTrackingActiveAlways` 的 tracking area 把进入/离开转成页面里的 `window.__shiyuBubbleHover`，应用在后台时也能展开工具栏。浮动窗固定为 92×126（顶部 92×92 是球，底部 34px 是工具栏），悬停时不再改原生窗口尺寸；窗口使用透明背景，圆圈之外不会留下方形色块，但球下方会保留一条透明区域。macOS 的透明 webview 依赖 `private_mac_apis` 构建标签。默认快捷键是 `Ctrl+Shift+Space`，在窗口获得焦点时由前端处理；Linux X11 环境如果安装了 `xbindkeys`，应用会进一步注册全局快捷键。Wayland 环境会显示不可用原因，仍可使用窗口内快捷键。

录音完成后，默认流程是“转写 → 整理 → 粘贴到触发录音前的当前光标”。X11 全局快捷键触发时，应用会先记录当前活动窗口，再写入原生剪贴板并使用 `wtype`（Wayland）或 `xdotool`（X11）发送粘贴按键；如果系统没有这两个工具，结果仍会复制到剪贴板，用户可以手动粘贴。设置中可以关闭自动粘贴、保持浮动圆圈置顶，或在粘贴后恢复原剪贴板内容。

历史记录中的每条结果都可以展开，查看完整整理文本，并选择“复制结果”或“粘贴到当前光标”。这些行为和模型配置分开保存，便于在办公软件、编辑器和浏览器之间切换。

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
  menu.go         浮动球的原生右键菜单（隐藏悬浮球、退出）
  hover_darwin.go 浮动球失焦悬停的 NSTrackingArea 桥（cgo）
  hover_other.go  无原生悬停桥平台的空实现
  app_options.go  Wails v3 窗口选项与平台差异
  chrome_darwin.go macOS 交通灯、borderless 与阴影切换（cgo）
  chrome_windows.go Windows 能力检测与样式提示
  chrome_*.go     无原生 chrome 平台的回退实现
  hotkey.go       X11 xbindkeys 全局快捷键适配
  injector.go     Linux/macOS/Windows 粘贴按键适配
frontend/bindings/  Wails v3 CLI 生成的 TypeScript 绑定（提交到仓库）
build/              Wails v3 构建配置、图标和各平台打包资源（图标 SVG 源在 build/icons/）
Taskfile.yml        Wails v3 构建任务入口
frontend/
  src/app/        入口、路由表、应用外壳（侧栏/顶栏/窗口层）与外观主题
  src/pages/      路由页面：记录、历史、调用记录
  src/features/   录音、转写、历史、调用、设置、桌面各业务模块与 store
  src/services/   Wails binding 适配、录音采集、平台检测、localStorage 兜底
  src/styles/     global.css（reset 与平台变量）、theme.css（设计 token）
  src/types/      领域模型与默认值；src/mocks/ 放浏览器预览的演示数据
main.go           Wails 应用入口和嵌入式静态资源
```
