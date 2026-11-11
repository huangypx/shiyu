# AGENTS.md

本文件写给在本仓库工作的开发者和 AI Agent。它记录仓库的硬性约定，尤其是注释语言：**所有手写源码注释必须使用中文**。

## 项目概览

拾语（Shiyu）是一个桌面语音输入与文字整理工具：前端用 React + Vite 采集和展示，Go 后端通过 Wails v3 暴露 ASR（语音转写）与 LLM（文字整理）调用，配置和历史记录保存在本机。

## 目录结构

```text
backend/        Wails 服务、配置、provider 客户端、DTO、历史与调用指标
desktop/        窗口层（原生 chrome）、浮动窗口、全局热键与粘贴注入
frontend/src/   React 应用：app/（外壳与路由）、pages/（页面）、features/（业务模块与 store）、
                services/（Wails 适配、录音、存储）、styles/（全局样式 token）、mocks/（演示数据）
frontend/bindings/ Wails v3 CLI 生成的 TypeScript 绑定（提交到仓库）
build/          Wails v3 构建配置、图标与各平台打包资源（图标 SVG 源在 build/icons/）
Taskfile.yml    Wails v3 构建任务入口
docs/           桌面交互设计与视觉基线
main.go         Wails 入口与嵌入式前端资源
```

## 常用命令

```bash
cd frontend && npm install          # 安装前端依赖
cd frontend && npm run dev          # Vite 浏览器预览
cd frontend && npm run lint         # ESLint（类型感知）
cd frontend && npm run format       # Prettier 写入
cd frontend && npm run test         # Vitest
cd frontend && npm run check        # lint + format:check + tsc + test + build
cd frontend && npm run build        # tsc 与 vite 构建
go test ./...                       # Go 单元测试
make bindings                       # 重新生成 frontend/bindings
make dev                            # 桌面开发模式（首次自动安装 wails3 到 .bin）
make build                          # 构建桌面应用（首次自动安装 wails3 到 .bin）
```

macOS 的透明浮动球依赖 Wails 的 `private_mac_apis` 私有 API；`make build` 会自动追加该标签，直接调用 `wails3 build` 时必须手动加。仅适合直接分发，不能提交 App Store。

如果运行环境无法写入默认的 Go 构建缓存（受限沙箱常见），把 `GOCACHE` 指到临时目录：

```bash
GOCACHE="$(mktemp -d)/gocache" go test ./...
```

## 注释规范（强制）

1. **所有手写源码注释使用中文，不写英文注释。** 适用于 Go、TypeScript/TSX、CSS、Makefile、Shell，以及 cgo 前言里的 C/Objective-C 注释。
2. **注释说明“为什么”，不复述代码。** 记录取舍、边界条件、平台差异和踩过的坑；能从代码直接读出的内容不要写。
3. **Go 文档注释以标识符开头**，例如：

   ```go
   // ASRConfig 描述一个 OpenAI 兼容的语音转写端点。
   type ASRConfig struct { ... }
   ```

4. **格式**：Go/TS 用 `//` 逐行书写，CSS 用 `/* */`；沿用所在文件的缩进与续行风格。整行不超过 100 显示列（中文按 2 列计），写不下时换行，不要挤成一行。
5. **排版**：中文与英文、数字之间留空格，正文用全角标点（，。：；）。技术专有名词保留英文：Wails、AppKit、Windows 11、Mica、WebKitGTK、MediaRecorder、ASR、LLM、OpenAI、WAV、RIFF、cgo、HTTP、JSON、base64、token。代码实体名（类型、函数、字段、命令）保持原文。
6. **只改注释文本**：不重排代码、不改字符串与标识符、不调整空行。
7. cgo 前言里的 C/Objective-C 注释同样写中文，但必须保持 C 语法有效（`//`、`/* */` 均可），并且不能改动 `#cgo` 指令与代码本体。

## 例外（保持英文原样）

- 构建约束与工具指令：`//go:build`、`//go:embed`、`// +build`、`//nolint`、`// eslint-disable`、`// prettier-ignore`、`// @ts-expect-error`。
- 生成文件：`frontend/bindings/**`（Wails v3 CLI 生成，文件头写明 `DO NOT EDIT`）、`frontend/package-lock.json`、`frontend/dist/`、`build/` 下的图标与平台资源。
- `go.mod` 里的 `// indirect` 是 Go 工具的语义标记。
- 字符串字面量、标识符、错误信息、日志、API 字段名、提交信息都不是注释，保持英文。

## 文档语言

`README.md`、`backend/README.md`、`docs/*.md` 统一使用中文；新增文档也遵循这一约定。

## 提交前自查

```bash
# 1. 格式、测试与前端构建
gofmt -l .
go test ./...
cd frontend && npm run check

# 2. 英文注释残留（期望无输出）
git grep -nE '^[[:space:]]*(//|\*|/\*).*\b(the|and|with|for|that|this|from|when|which|because|into|should|must)\b' \
  -- '*.go' '*.ts' '*.tsx' '*.css' 'Makefile'
```

`git grep` 只搜索已跟踪文件，新增文件请先 `git add`（或 `git add -N`）再自查。

## 提交约定

- 提交信息使用英文 Conventional Commits（`feat:`、`fix:`、`docs:`、`chore:` 等），与仓库历史一致；一个提交只做一件事。
- 不要擅自 `git push`，也不要改写已经推送的历史。
