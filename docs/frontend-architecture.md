# 前端架构

这份文档描述 `frontend/src` 的组织方式与约定。目标是让新页面和新组件知道该放在哪里、依赖什么、不该越过哪些边界。

## 目录

```text
src/
  main.tsx            挂载：先写 <html data-platform> ，再挂 AppTheme 与路由
  app/
    App.tsx           窗口模式切换、路由与关闭确认
    providers.tsx     外观偏好解析 + Radix Theme 默认值
    router.tsx        createHashRouter 路由表
    layout/           主窗口外壳、标题栏、工具栏和窗口按钮
    useFeedback.ts    主窗口 Toast 与悬浮球通知的统一入口
  pages/              路由页面：record、history、calls
  features/           按业务能力切分，页面只做组装
    recorder/         录音入口、波形、录音状态机
    transcript/       双栏编辑区，左侧原文与右侧整理结果
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
  lib/                纯函数与通用工具，如错误描述、相对时间和快捷键格式
  test/               Vitest setup
```

## 路由

三个视图是真正的路由页面，用 `createHashRouter`：

| 路径 | 页面 |
| --- | --- |
| `#/` | 转写原文与整理结果对照页 |
| `#/history` | 历史记录 |
| `#/calls` | 调用记录 |

使用 hash 的原因：Wails 的 assetserver 只提供一份 `index.html`，path 路由在刷新时会 404，而 hash 路由在 `wails dev`、打包产物和浏览器预览里行为一致。

设置弹窗由界面状态控制，主窗口快捷键和悬浮球右键菜单都能打开。

## 状态

`zustand` 分片 store，每个 store 只放一类状态：

| store | 内容 |
| --- | --- |
| `store/uiStore` | 设置弹窗、Toast、外观偏好、悬浮球通知 |
| `store/sessionStore` | 录音状态机（`idle` / `arming` / `recording` / `processing`）、处理阶段（`stage`: `transcribe` / `organize`）、转写与整理文本、调用指标、计时 |
| `store/desktopStore` | 窗口模式、平台、backdrop 提示、快捷键注册结果 |
| `features/settings/settingsStore` | 模型池、整理预设与桌面设置，负责 `hydrate` / `selectPreset` / `selectModel` / `save` |
| `features/history/notesStore` | 历史记录，读写 Go 的 SQLite；浏览器预览回落到 localStorage |
| `features/calls/callsStore` | 调用日志，来自 Go 的会话内存 |
| `features/desktop/windowTransitionStore` | 一次主窗口↔悬浮球过渡的方向、时长、锚点和起止 frame；不持久化 |

手动收起窗口时，`desktop:transition` 事件提供窗口位置、尺寸和动画时长。`AppShell` 与 `WindowTransition` 使用 `windowTransitionStore` 绘制过渡。自动转入后台时直接切换。`useBubbleActivity` 根据录音状态、通知和整理结果决定悬浮球是否显示。

约定：

- 组件用选择器订阅单个字段，不要订阅整个 store 对象，否则任何字段变化都会重渲染。
- 异步流程里读最新状态用 `useStore.getState()`，不要依赖闭包里的旧值。
- 录音器实例是模块级变量：全局快捷键可能在 App 触发，停止按钮却在页面里。
- 麦克风电平走订阅而不是 store：`services/recorder.ts` 的 `subscribeMicLevel` 每秒推送几十次，组件用 `useMicLevelVar` 把它写进 CSS 变量 `--mic-level`，避免整棵树按音量重渲染。
- 状态切换必须等采集确认：`WavRecorder.ready` resolve 之后才允许从 `arming` 进入 `recording`，否则用户会对着还没生效的麦克风说话。
- 流式转写的增量文本由 `subscribeAsrPartial` 模块级订阅一次（多个组件都会调用 `useRecordingActions`，各自订阅会把同一段文本重复写进面板），载荷是累计文本，直接覆盖写进 `sessionStore.transcript`。
- 取消用递增的「处理代号」而不是布尔标记：`cancelTranscription` 把代号 +1 并 abort 本地 `AbortController`，后端 `CancelTranscription` 负责中断在途 HTTP；每个 `await` 之后核对代号，对不上的结果静默丢弃。
- `transcript` 与 `organized` 分别驱动原文与结果栏。流式转写、手动修改原文和整理结果到达时各自更新，保留用户当前的编辑焦点。

## 服务层

`services/bridge.ts` 封装 Wails 的生成绑定、事件回调和可取消请求。原生窗口通过宿主平台信息或 WebView 消息通道识别。普通浏览器使用演示数据，复制走 `navigator.clipboard`。

### 持久化

本地存储的完整约定（路径、schema、迁移）见 [`docs/storage.md`](storage.md)，这里只说明前端这一侧的分工：

- **桌面端**：配置来自 `~/.shiyu/config.json`，历史来自 `~/.shiyu/history.db`。`settingsStore.hydrate` 与 `notesStore.hydrate` 在启动时各拉一次，之后写操作直接调后端。
- **浏览器预览**：`isDesktop()` 为假，`bridge` 返回 `undefined`，store 保留本地副本并继续使用演示数据。
- `services/storage.ts` 只负责 localStorage 兜底与迁移用的 key，不能改名：

  - `typeless-settings`、`typeless-desktop-settings`：预览环境的配置副本
  - `typeless-notes`：预览环境的历史；桌面端首次启动会把它导入 SQLite，成功后删除
  - `typeless-appearance`：保存配色方案及经典黑白的明暗偏好。缺少配色字段时使用青瓷绿 × 朱红。

启动顺序有依赖：`settingsStore.hydrate` 必须先完成，`notesStore.hydrate` 才迁移旧记录——迁移时要读当前模型配置来补齐历史里的模型 ID。

## 样式

- 组件样式写 `Component.module.css`，与组件同目录；不引入全局类名。
- 颜色只使用 `styles/theme.css` 里的 `--app-*` 或 Radix 的 `--gray-*` / `--indigo-*` 等色阶，禁止字面色值（`theme.css` 与窗口控件特例除外）。
- 青瓷使用浅色基础控件，梅紫使用深色基础控件。经典黑白沿用用户的浅色、深色或跟随系统偏好。浮动窗口与主窗口读取同一份配色。
- 设计 token 定义在 `.radix-themes` 上，因为 Radix 的颜色变量只存在于主题容器内；写进 `:root` 会导致所有别名失效。
- 断点仍是 900px 与 680px，CSS 变量不能用在 media query 里，保持字面值。

## 组件库

Radix Themes 提供按钮、弹窗、下拉、开关、标签页、输入框与 Toast 之外的全部基础控件；`@radix-ui/react-collapsible` 负责可展开区域，`@radix-ui/react-toast` 负责提示条。

主窗口转场遵循系统的减少动态效果偏好。原文和整理结果同时显示，正文更新不切换视图。

`BubbleWindow` 显示录音状态、波形、通知或可复制的结果。右键菜单使用 Wails 的原生 `ContextMenu`，可展开主窗口、取消转写、打开偏好设置、隐藏悬浮球或退出。

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
