# 前端架构

这份文档描述 `frontend/src` 的组织方式与约定。目标是让新页面和新组件知道该放在哪里、依赖什么、不该越过哪些边界。

## 目录

```text
src/
  main.tsx            挂载：先写 <html data-platform> ，再挂 AppTheme 与路由
  app/
    App.tsx           浮动模式分支 / RouterProvider，≤ 40 行
    providers.tsx     外观偏好解析 + Radix Theme 默认值
    router.tsx        createHashRouter 路由表
    layout/           AppShell、Sidebar、TopBar、WindowControls
    useFeedback.ts    主窗口 Toast / 浮动窗闪烁的统一出口
  pages/              路由页面：record、history、calls
  features/           按业务能力切分，页面只做组装
    recorder/         记录页栏头的录音按钮、浮窗波形、录音状态机
    transcript/       双栏工作台：识别结果 + 转写内容
    history/          历史列表与 notesStore
    calls/            调用记录、调用详情、格式化函数
    settings/         设置弹窗、整理预设编辑（presets.ts 纯函数）与 settingsStore
    desktop/          浮动窗、桌面事件、快捷键、窗口动作
  components/ui/      跨 feature 的通用件（Toast）
  services/           bridge（Wails 绑定）、recorder、platform、storage
  store/              跨 feature 的全局状态：uiStore、sessionStore、desktopStore
  styles/             global.css（reset/平台变量）、theme.css（设计 token）
  types/              models.ts（领域模型与默认值）
  mocks/              浏览器预览用的演示数据
  lib/                纯函数：错误描述、相对时间、快捷键格式化与媒体查询
  test/               Vitest setup
```

## 路由

三个视图是真正的路由页面，用 `createHashRouter`：

| 路径 | 页面 |
| --- | --- |
| `#/` | 记录页（双栏工作台 + 栏头录音） |
| `#/history` | 历史记录 |
| `#/calls` | 调用记录 |

使用 hash 的原因：Wails 的 assetserver 只提供一份 `index.html`，path 路由在刷新时会 404，而 hash 路由在 `wails dev`、打包产物和浏览器预览里行为一致。

设置弹窗**不进路由**。它需要能从浮动球设置图标和全局快捷键在任意页面打开，路由切换会卸载正在编辑的表单。

## 状态

`zustand` 分片 store，每个 store 只放一类状态：

| store | 内容 |
| --- | --- |
| `store/uiStore` | 侧栏开合、记录页两栏比例、设置弹窗、Toast 队列、外观偏好、浮动窗闪烁 |
| `store/sessionStore` | Go 会话状态的投影：状态机、处理阶段、转写与整理文本、调用指标；`copied`（记录哪一栏刚复制过）是本地呈现字段 |
| `store/desktopStore` | 窗口模式、平台、backdrop 提示、快捷键注册结果 |
| `features/settings/settingsStore` | 模型池、整理预设与桌面设置，负责 `hydrate` / `selectPreset` / `selectModel` / `selectLanguage` / `save` |
| `features/history/notesStore` | 历史记录，读写 Go 的 SQLite；浏览器预览回落到 localStorage |
| `features/calls/callsStore` | 调用日志，来自 Go 的会话内存 |

窗口切换不再有前端动画状态：Go 按角色创建/销毁窗口，前端按 `?view=main|bubble|overlay` 选择入口。`useSessionBridge` 在挂载时调用 `Controller.GetSession()` 并订阅 `desktop:session`；所有会话状态由 Go 流水线写入，三个窗口只读。会话状态因此不会随窗口销毁而丢失。

约定：

- 组件用选择器订阅单个字段，不要订阅整个 store 对象，否则任何字段变化都会重渲染。
- 异步流程里读最新状态用 `useStore.getState()`，不要依赖闭包里的旧值。
- 录音、转写和整理全部在 Go 后端；三个视图通过 `ToggleRecording` / `CancelTranscription` / `OrganizeSession` 发命令。
- 麦克风电平在 Go 的音频回调里算好，经 `desktop:mic-level` 广播，组件用 `useMicLevelVar` 写进 CSS 变量 `--mic-level`，避免整棵树按音量重渲染。
- 会话状态由 Go 的 `publishSessionState` 写入并广播；前端只在空闲时用 `PublishSession` 提交草稿编辑，录音/整理期间前端写入会被拒绝。
- 流式转写的增量文本由 Controller 监听 `asr:partial` 并写进唯一会话状态，视图不再直接订阅服务商事件。
- 取消由 Go 递增会话代号并中断在途 ASR/LLM 请求；音频线程和异步流水线在每个关键点核对代号，过期结果直接丢弃。
- 两栏始终同时挂载，不靠状态切换视图：`organized` 只决定右栏文本域的内容，被清空（取消、新一次录音、从历史打开空记录）就回到占位空态；左栏的 `transcript` 是原文的唯一副本，右栏不复制它。处理中的两段靠 `stage` 区分，界面才能说准是在识别还是在整理。
- 两栏都是可以直接书写的文本域，没有「编辑」模式开关：右栏的改动通过 `setOrganized` 走与左栏 `setTranscript` 相同的 `PublishSession` 通道落回 Go（只在 idle 时接受）。流式返回期间两栏自动只读，输出完成后自动恢复，避免本地改动被下一段增量覆盖。

## 服务层

`services/bridge.ts` 是唯一与 Wails 绑定的地方，其它模块只调用它导出的函数。它把后端事件（`desktop:session`、`desktop:notice`、`desktop:mic-level`、`desktop:state` 等）转成回调；`raceWithAbort` 与 `TransferCancelled` 仍保留给需要本地提前结束等待的调用。桌面端导入 Wails v3 CLI 生成的 `frontend/bindings/**`，并用 `window._wails` 判断运行时是否存在；浏览器预览没有该运行时，函数会返回 `undefined` 或退化成 `navigator.clipboard`，调用方负责决定演示数据与降级提示。

### 持久化

本地存储的完整约定（路径、schema、迁移）见 [`docs/storage.md`](storage.md)，这里只说明前端这一侧的分工：

- **桌面端**：配置来自 `~/.shiyu/config.json`，历史来自 `~/.shiyu/history.db`。`settingsStore.hydrate` 与 `notesStore.hydrate` 在启动时各拉一次，之后写操作直接调后端。
- **浏览器预览**：`isDesktop()` 为假，`bridge` 返回 `undefined`，store 保留本地副本并继续使用演示数据。
- `services/storage.ts` 只负责 localStorage 兜底与迁移用的 key，不能改名：

  - `typeless-settings`、`typeless-desktop-settings`：预览环境的配置副本
  - `typeless-notes`：预览环境的历史；桌面端首次启动会把它导入 SQLite，成功后删除
  - `typeless-appearance`：唯一只存在前端的外观偏好

启动顺序有依赖：`settingsStore.hydrate` 必须先完成，`notesStore.hydrate` 才迁移旧记录——迁移时要读当前模型配置来补齐历史里的模型 ID。

## 样式

- 组件样式写 `Component.module.css`，与组件同目录；不引入全局类名。
- 颜色只使用 `styles/theme.css` 里的 `--app-*` 或 Radix 的 `--gray-*` / `--indigo-*` 等色阶，禁止字面色值（`theme.css` 与窗口控件特例除外）。
- 深浅色共用一套规则：Radix 色阶会随 `<Theme appearance>` 自动翻转。
- 设计 token 定义在 `.radix-themes` 上，因为 Radix 的颜色变量只存在于主题容器内；写进 `:root` 会导致所有别名失效。
- 断点仍是 900px 与 680px，CSS 变量不能用在 media query 里，保持字面值。

## 组件库

Radix Themes 提供按钮、弹窗、下拉、开关、标签页、输入框与 Toast 之外的全部基础控件；`@radix-ui/react-collapsible` 负责可展开区域，`@radix-ui/react-toast` 负责提示条。

记录页不再引入动效库：`motion` 依赖已经移除，两栏常驻、没有换面动画；悬停、状态色、栏目让位这类过渡全部用 CSS `transition`，窗口外壳的入场动画也写在 `AppShell.module.css` 里。`prefers-reduced-motion` 下这些过渡统一快速结束，两栏内容不切换、不重排。

浮动球的主操作放在前端绘制的悬停工具栏里，只有「隐藏悬浮球」「退出拾语」还走 Wails v3 的原生 `ContextMenu`。macOS 的 WebKit 默认只在 key window 更新 hover，`desktop/hover_darwin.go` 用 `NSTrackingActiveAlways` 的 tracking area 把进入/离开转成 `window.__shiyuBubbleHover`，保证应用失焦时工具栏也能出现；鼠标移动时还会把坐标送进 `window.__shiyuBubblePointer`，由页面命中按钮并加 `data-hovered`。工具栏不经过 Radix Portal。

## 工程化

```bash
npm run dev          # Vite，端口 5173
npm run lint         # ESLint（类型感知）+ jsx-a11y + import 排序
npm run format       # Prettier
npm run typecheck    # tsc -b
npm run test         # Vitest + Testing Library
npm run check        # 上面四项加 build 一次跑完
```

ESLint 打开 `@typescript-eslint/no-floating-promises`：Wails 调用全是 Promise，漏掉 `await` 只会表现成「界面没反应」。React 事件属性上的 Promise 返回被放行，避免到处写 `void`。
