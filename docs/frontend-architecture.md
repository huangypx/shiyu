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
    recorder/         录音入口、波形、录音状态机
    transcript/       记录卡：原始记录 ⇄ 整理结果两面
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
  lib/                纯函数：错误描述、日期与问候语
  test/               Vitest setup
```

## 路由

三个视图是真正的路由页面，用 `createHashRouter`：

| 路径 | 页面 |
| --- | --- |
| `#/` | 记录页（录音 + 可翻转的记录卡） |
| `#/history` | 历史记录 |
| `#/calls` | 调用记录 |

使用 hash 的原因：Wails 的 assetserver 只提供一份 `index.html`，path 路由在刷新时会 404，而 hash 路由在 `wails dev`、打包产物和浏览器预览里行为一致。

设置弹窗**不进路由**。它需要能从浮动窗右键菜单和全局快捷键在任意页面打开，路由切换会卸载正在编辑的表单。

## 状态

`zustand` 分片 store，每个 store 只放一类状态：

| store | 内容 |
| --- | --- |
| `store/uiStore` | 侧栏开合、设置弹窗、Toast 队列、外观偏好、浮动窗闪烁 |
| `store/sessionStore` | 录音状态机（`idle` / `arming` / `recording` / `processing`）、处理阶段（`stage`: `transcribe` / `organize`）、转写与整理文本、调用指标、计时 |
| `store/desktopStore` | 窗口模式、平台、backdrop 提示、快捷键注册结果 |
| `features/settings/settingsStore` | 模型池、整理预设与桌面设置，负责 `hydrate` / `selectPreset` / `selectModel` / `save` |
| `features/history/notesStore` | 历史记录，读写 Go 的 SQLite；浏览器预览回落到 localStorage |
| `features/calls/callsStore` | 调用日志，来自 Go 的会话内存 |
| `features/desktop/windowTransitionStore` | 一次主窗口↔悬浮球过渡的方向、时长、锚点和起止 frame；不持久化 |

窗口切换是唯一不进全局 store 的桌面动画状态：`windowTransitionStore` 只共享一次 transition，供 `AppShell`、`BubbleWindow` 和 `WindowTransition` 同时读取。收起时 `WindowTransition` 用当前 `innerWidth` 和锚点逐帧算水滴几何；展开不画水滴，只等悬浮球淡出、原生窗口落回 Go 记住的 frame 后，铺一层画布遮罩并让主界面在 200ms 内淡入。动画的起止 frame 与时长由 Go 的 `desktop:transition` 事件给出，前端不猜原生窗口的边界。

约定：

- 组件用选择器订阅单个字段，不要订阅整个 store 对象，否则任何字段变化都会重渲染。
- 异步流程里读最新状态用 `useStore.getState()`，不要依赖闭包里的旧值。
- 录音器实例是模块级变量：全局快捷键可能在 App 触发，停止按钮却在页面里。
- 麦克风电平走订阅而不是 store：`services/recorder.ts` 的 `subscribeMicLevel` 每秒推送几十次，组件用 `useMicLevelVar` 把它写进 CSS 变量 `--mic-level`，避免整棵树按音量重渲染。
- 状态切换必须等采集确认：`WavRecorder.ready` resolve 之后才允许从 `arming` 进入 `recording`，否则用户会对着还没生效的麦克风说话。
- 流式转写的增量文本由 `subscribeAsrPartial` 模块级订阅一次（多个组件都会调用 `useRecordingActions`，各自订阅会把同一段文本重复写进面板），载荷是累计文本，直接覆盖写进 `sessionStore.transcript`。
- 取消用递增的「处理代号」而不是布尔标记：`cancelTranscription` 把代号 +1 并 abort 本地 `AbortController`，后端 `CancelTranscription` 负责中断在途 HTTP；每个 `await` 之后核对代号，对不上的结果静默丢弃。
- 记录卡的翻面跟随数据而不是自己记状态：`organized` 有内容就落在「整理结果」一面，被清空（新一次录音、取消、关掉结果预览）就回「原始记录」；用户手动翻面只是一次临时覆盖，下一次数据变化就让它失效。处理中的两段靠 `stage` 区分，界面才能说准是在识别还是在整理。

## 服务层

`services/bridge.ts` 是唯一与 Wails 绑定的地方，其它模块只调用它导出的函数。它同时负责两件事：把后端事件（`asr:partial`、`desktop:cancel-transcribe`、`desktop:state` 等）转成回调，以及在取消时把等待方从 `await` 里立刻放出来（`raceWithAbort` 抛 `TransferCancelled`）。桌面端导入 Wails v3 CLI 生成的 `frontend/bindings/**`，并用 `window._wails` 判断运行时是否存在；浏览器预览没有该运行时，函数会返回 `undefined` 或退化成 `navigator.clipboard`，调用方负责决定演示数据与降级提示。

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

JS 驱动的动效走 `motion`（Framer Motion 的现行包）：记录卡的两面背对背常驻在同一个网格单元里，整张卡一次转 180°，转到一半时才露出另一面，因此不需要 `AnimatePresence` 换面；动效按需加载 `domAnimation`。背面用 `aria-hidden` + `inert` 关在可访问性树和 Tab 之外。悬停、状态色这类单值过渡仍用 CSS `transition`，不必为它引入动效库；`prefers-reduced-motion` 下不做翻转，两面改为淡入淡出。

浮动窗的右键菜单使用 Wails v3 的原生 `ContextMenu`，不经过 Radix Portal，也不再出现「窗口放大成 296×276」的自绘菜单几何。

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
