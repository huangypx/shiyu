.PHONY: tools install bindings dev frontend-build frontend-check prompts-format prompts-check test build check

# Wails 的 Taskfile 内部会再次调用 wails3（例如 dev 的 build 步骤）。
# 只把 go run 的临时进程当作 CLI 不够：子进程的 PATH 里没有 wails3。
# 因此固定安装到仓库内的 .bin，并让所有 recipe 都先看到它。
WAILS3_VERSION ?= v3.1.0
WAILS3_DIR := $(CURDIR)/.bin
WAILS3 ?= $(WAILS3_DIR)/wails3

export PATH := $(WAILS3_DIR):$(PATH)

tools:
	GOBIN="$(WAILS3_DIR)" go install github.com/wailsapp/wails/v3/cmd/wails3@$(WAILS3_VERSION)

# macOS 的透明 webview 依赖 Wails 的 private_mac_apis 构建标签；
# Windows/Linux 不能带这个标签，否则会编译失败。
ifeq ($(shell uname -s),Darwin)
WAILS_TAGS ?= private_mac_apis
endif

# Ubuntu 26.04 等较新发行版提供 WebKitGTK 4.1。Wails 为兼容性
# 仍默认使用 4.0，因此只有在 pkg-config 能查到 4.1 时才启用
# 对应的 cgo 绑定。较老的发行版上该变量留空，Wails 照常
# 使用 WebKitGTK 4.0。
ifeq ($(shell pkg-config --exists webkit2gtk-4.1 2>/dev/null && echo yes),yes)
ifneq ($(WAILS_TAGS),)
WAILS_TAGS := $(WAILS_TAGS),webkit2_41
else
WAILS_TAGS := webkit2_41
endif
endif

install:
	cd frontend && npm install

bindings: tools
	$(WAILS3) generate bindings -ts -d frontend/bindings

# 桌面开发模式：Vite 热更新 + Wails 窗口，端口与 Taskfile 保持一致。
# 需要 wails3 在 PATH 中；go run 的临时进程无法满足 Taskfile 内部的
# wails3 调用。
dev: tools
	$(WAILS3) dev -config ./build/config.yml -port 9245

frontend-build:
	cd frontend && npm run build

frontend-check:
	cd frontend && npm run check

# 提示词模板的排版规则在 internal/promptfmt：gofmt 管不到 *.tmpl。
prompts-format:
	go run ./cmd/promptfmt -w backend/prompts

prompts-check:
	go run ./cmd/promptfmt backend/prompts

test:
	go test ./...

# 提交前的完整自查：前端 lint/format/类型/测试/构建，Go 测试，模板排版。
check: frontend-check test prompts-check

build: tools
	$(WAILS3) build $(if $(WAILS_TAGS),-tags "$(WAILS_TAGS)")
