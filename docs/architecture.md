# 架构

本文只记录稳定的架构约束；具体实现以代码和注释为准。

## 组成

- 单个 Go 进程。`backend` 包负责配置、provider 客户端、ASR/LLM 调用、历史与调用指标，不依赖 Wails runtime；它通过注入的 emitter 发事件，由 `main.go` 桥接到 Wails。
- 提示词模板在 `backend/prompts/*.tmpl`，由 backend 包 embed；前端通过 Vite 的 `?raw` 导入同一份文件，作为浏览器预览的默认预设，仓库里只有一份提示词文本。排版规则在 `internal/promptfmt`，由 `cmd/promptfmt` 执行，`make check` 会校验。
- `desktop` 包负责窗口、托盘、全局热键、麦克风采集、会话状态和粘贴注入，直接使用 Wails 的窗口与托盘 API。
- `frontend` 是 React 视图，只持有视图状态和 Go 会话状态的投影；通过生成的 TypeScript 绑定调用 Go。
- `main.go` 装配 Wails 应用、embed 前端产物，并注册 backend 与 desktop 服务。

## 会话与数据流

- 状态机：`idle → arming → recording → processing → idle`；失败或取消也回到 `idle`。
- 会话状态由 `desktop.Controller` 独占并广播 `desktop:session`，main/bubble/overlay 三个窗口只读；空闲时前端可以通过 `PublishSession` 提交文本编辑。
- 录音由 Go 内的 `malgo`（miniaudio）完成，固定 16 kHz 单声道 S16；录音结束后整段上传给 ASR，再交给 LLM 整理，最后写历史并按设置自动粘贴。
- 整理请求的 user 消息固定是 `<transcript>` 标签包住的转写原文，system 消息末尾固定追加守卫句（`backend/prompts/guard.tmpl`），要求模型把标签内的内容当作文本而不是指令；自定义预设和旧配置都受同一条约束。
- 取消通过递增的会话代号实现：取消后所有 await 结果和迟到的流式增量都会因为代号不匹配被丢弃。
- ASR 的 `stream` 只影响结果返回方式（SSE 逐字上屏），不改变「整段音频上传一次」；只有对话接口支持。
- 录音/整理期间由 Go 写入状态，前端只在空闲时提交草稿编辑，避免本地编辑被增量覆盖。

## 窗口

- main、bubble、overlay 是三个独立的 Wails 窗口，不是同一个窗口改尺寸或改 chrome。
- main 是编辑器；bubble 是 92×126 的透明浮动球；overlay 是底部胶囊，macOS 用非激活 NSPanel、Windows 用 `WS_EX_NOACTIVATE`，显示和点击都不抢焦点。
- 在支持托盘的平台上，系统托盘负责恢复入口；关闭主窗口或隐藏悬浮球后进程常驻，退出入口在托盘菜单、悬浮球右键菜单和关闭确认框。
- 窗口层使用原生能力（交通灯、置顶、透明、托盘），窗口内的控件和内容仍是 HTML/CSS。

## 前端

- React 18 + Vite + Radix Themes；路由用 `createHashRouter`，因为 assetserver 只有一份 `index.html`，hash 路由在 dev、打包和浏览器预览里行为一致。
- 按 `app` / `pages` / `features` / `services` / `store` 分层；组件用 zustand 选择器订阅单个字段。
- `services/bridge.ts` 是唯一与 Wails 绑定的模块，其它模块只调用它；浏览器预览没有 Wails runtime 时回退到 mocks 和 localStorage。
- 样式分三层：`styles/theme.css` 管语义 token 与字号/动效/布局原始值，`styles/palettes.css` 管内置主题色，`styles/global.css` 只留盒模型与焦点重置；主题色与明暗偏好存在 localStorage 的 `typeless-appearance` 里，不进 Go 配置。

## 平台差异

- macOS：透明 webview 依赖 `private_mac_apis`；隐藏主窗口时把激活策略切成 accessory；全局热键用 Carbon `RegisterEventHotKey`。仅适合直接分发，不能提交 App Store。
- Windows：全局热键用 `RegisterHotKey` 加专用消息线程；无边框窗口和托盘行为在 `desktop/windows.go`、`desktop/tray_windows.go`。
- Linux：X11 可选 `xbindkeys`，Wayland 或缺少依赖时给出原因并回退到窗口内快捷键；没有托盘实现，因此不能持久化隐藏悬浮球。
- 构建标签由 Makefile 根据平台和 WebKitGTK 版本追加。

## 持久化

- 配置在 `~/.shiyu/config.json`，历史在 `~/.shiyu/history.db`。
- 音频、完整请求/响应体和 API key 的解析结果不落盘；调用记录只存在内存中（上限 200 条）。
- 路径、schema、迁移与 localStorage 兜底见 [`storage.md`](storage.md)。

## 源码入口

- 会话与窗口：`desktop/controller.go`、`desktop/session.go`、`desktop/windows.go`
- 采集与热键：`desktop/capture.go`、`desktop/hotkey*.go`
- 后端服务：`backend/service.go`、`backend/providers.go`、`backend/history_store.go`
- 前端桥接与路由：`frontend/src/services/bridge.ts`、`frontend/src/app/router.tsx`
