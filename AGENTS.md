# AGENTS.md

本文件是本仓库的硬约束。项目说明与贡献说明见 README。

## 注释

- 所有手写源码注释使用中文；生成文件、工具指令和字符串字面量保持原样。
- 注释说明「为什么」，不复述代码；Go 文档注释以标识符开头。
- 不要手改 `frontend/bindings/**`，需要更新时运行 `make bindings`。
- cgo 前言里的 C/Objective-C 注释同样用中文，但必须保持 C 语法有效。

## 常用命令

```bash
make check       # 前端 lint/format/typecheck/test/build + go test
make dev         # 桌面开发模式（首次自动安装 wails3 到 .bin）
make build       # 构建桌面应用
make bindings    # 重新生成 TypeScript 绑定
gofmt -l .       # 期望无输出
```

直接调用 `wails3 build` 时要自己带平台标签：macOS 需要 `private_mac_apis`，WebKitGTK 4.1 需要 `webkit2_41`；`make build` 已处理。

## 文档纪律

- 只维护 README、`docs/architecture.md`、`docs/storage.md`；行为、数据结构或构建方式变化时同步更新对应文档。
- **除非用户明确要求，或确实存在必要的长期维护价值，否则不要新建 Markdown 文档、开发日志、任务总结、计划或完成报告。**
- 不要新增子目录 AGENTS.md；本项目只有根级这一份。
- 文档使用中文。

## 提交

- 提交信息使用英文 Conventional Commits，一个提交只做一件事。
- 不要擅自 `git push`，也不要改写已经推送的历史。
