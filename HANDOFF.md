# HANDOFF

> Updated: 2026-11-13
> Task: 继续未完成的 FR-08 本设备签名库，完成 M3 实现与自动化验证。

## 1. Goal

在纯浏览器内完成签名主动保存、复用、管理、PNG 备份及可选 PIN 加密；PDF 与文件名不持久化。

## 2. Completed

- 接续原有未提交的 IndexedDB、Web Crypto、library store 和测试实现，完成首页与编辑器界面接入。
- 首页“我的签名（N）”支持不打开 PDF 创建与管理签名；编辑器添加签名默认显示非空签名库。
- 默认不勾选保存；首次保存需确认存储风险及合同场景说明。支持名称、可选 PIN、PNG 备份、失败提示。
- 支持重命名、删除、清空、PIN 设置/修改/移除、解锁和锁定。
- 锁定清除加密签名的库预览及编辑器副本和放置；删除/清空同样清除相关会话副本。操作前提示影响，PRD 已同步。
- 修复移除 PIN 后残留解锁状态、异步 IDB 写入失败的事务 Promise 拒绝处理。
- 新增界面流程、锁定与会话副本、异步事务失败及下载文件名测试；PRD M3 标记完成。

## 3. Current State

### Changed / Key Files

- `apps/web/src/services/signature-crypto.ts` — PBKDF2-SHA256 / AES-GCM。
- `apps/web/src/services/signature-vault.ts` — IndexedDB、容量限制及持久化授权。
- `apps/web/src/stores/library.ts` — 库状态、解锁内存及会话清理。
- `apps/web/src/components/library/LibraryList.vue` — 库列表与管理。
- `apps/web/src/components/library/PinDialog.vue` — PIN 操作。
- `apps/web/src/components/signature/SignatureDialog.vue` — 三标签创建/选用与保存确认。
- `apps/web/src/views/HomeView.vue`、`EditorView.vue` — 入口与放置接入。
- `apps/web/src/components/signature/__tests__/SignatureDialog.test.ts` — 关键界面流程。
- `docs/InkSign_PRD_v1.3.md` — FR-08 行为和 M3 清单。

### Validation

- Lint: `pnpm -C apps/web lint:fix` 通过。
- Build / Typecheck: `pnpm -C apps/web build` 通过，包含测试类型检查。
- Tests: 使用本机 Git OpenSSL 临时加入 PATH 后，`pnpm -C apps/web test` 最终 26 文件通过，219 项通过，2 项样例生成按条件跳过，0 失败。真实数字签名导出及导入回归通过。
- `git diff --check` 通过（仅 LF/CRLF 提示）。
- Manual verification: 未完成。CDP 前置检查发现 Chrome 9222 可连接，但 Proxy 3456 等待授权并超时；未启动浏览器验收或改动用户数据。

### Git State

- 所有开发变更未提交；开始时已存在签名库基础代码及 `fake-indexeddb` devDependency / lockfile 修改，本轮继续沿用。
- `docs/InkSign-Logo图标.zip` 为开始时已有的未跟踪文件，未操作。

## 4. Blockers / Unresolved Issues

- 真实浏览器验收：CDP Proxy 未就绪，需连接/授权后继续，尚无真实浏览器截图与移动端验收结论。
- Vite 仍提示部分 PDF 分块超过 500 kB；构建成功。

## 5. Next Steps

1. CDP 可用后验收首页创建、保存加密签名、刷新后锁定、选用并导出 PDF、PNG 备份回导及移动端对话框。
2. 核对 PRD M4 剩余事项与实际代码，推进质量/部署验收；M4 清单包含部分早已实现的内容，需要以仓库为准。
3. 用户要求时再提交本轮代码。

## 6. Decisions and Constraints

- 不上传用户数据，不持久化 PDF/文件名，不新增依赖。
- 锁定/删除同步移除编辑器签名和放置，避免清库或锁定后留下可使用的会话副本；确认文案已明确。
- 测试运行交由 subagent；Node 24.22.0、pnpm 11.25.0。

## 7. Pitfalls / Do Not Repeat

- happy-dom 的 `.click()` 不会模拟用户聚焦。嵌套 PIN Dialog 关闭会恢复焦点，若焦点残留在手写 tab，会触发自动切换。界面测试 click helper 先 `.focus()` 再 `.click()`；已保留解锁与活动 tab 断言。
- 默认 PATH 无 OpenSSL。最终验证临时加入 `C:\Program Files\Git\usr\bin`，无需安装或永久修改环境。
- 默认 bash 指向不可用 WSL；web-access 检查可用已有 Git Bash，但 CDP Proxy 仍被连接/授权阻塞。

## 8. Resume Context

先读本文件、PRD FR-08/M4、`SignatureDialog.vue`、`library.ts`，再检查 `git status` 和 `git diff`。M3 自动化验证已完成，下一步优先真实浏览器验收。
