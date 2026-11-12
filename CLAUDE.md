# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

仓库级的产品约束、命令、工作区边界统一维护在 `AGENTS.md`，这里直接导入，避免两份文档不同步：

@AGENTS.md

## 补充说明

- 本仓库是墨签（InkSign）：纯浏览器端 PDF 可视化签名工具，pnpm workspace + Turborepo，应用为 `apps/web`（Vue 3），共享代码在 `packages/ui`（`@repo/ui`）与 `packages/utils`（`@repo/utils`）。没有服务端和管理后台（PRD 第 14 节），不要引入。
- 需求以 `docs/InkSign_PRD_v1.2.md` 为准；实现与 PRD 冲突时先和用户确认，再同步修改 PRD（更新版本号与修订记录）。
- 项目从 `bao-linfeng/agent-template` 裁剪而来；以后若按 PRD 第 14 节的条件重新引入服务端，可从该模板取回 `apps/server` 与 `apps/admin`。
- 修改 `turbo.json` 或 Turbo 相关命令前，按 `AGENTS.md` 末尾的说明先阅读已安装 `turbo` 包内的 `docs/`。
