# InkSign（墨签）

免费、轻量、隐私优先的浏览器端 PDF 可视化签名工具：在本地浏览器中打开 PDF，手写或上传签名，放置到页面上并导出。文件不上传服务器，无需注册。

> 墨签提供的是**可视化签名**（把签名图像写入 PDF），不是基于数字证书的数字签名，不提供身份核验、时间戳或法律效力保证。

产品需求、技术方案与里程碑见 [docs/InkSign_PRD_v1.2.md](docs/InkSign_PRD_v1.2.md)。

## 项目结构

pnpm workspace + Turborepo monorepo，纯静态前端，没有服务端（理由见 PRD 第 14 节）。

| 目录                         | 用途                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `apps/web`                   | 墨签应用（Vue 3 + Vite），尚未创建，见 PRD 里程碑 M1   |
| `packages/ui`                | `@repo/ui`：shadcn-vue 组件 + 共享 Tailwind 4 主题映射 |
| `packages/utils`             | `@repo/utils`：框架无关的样式与主题工具                |
| `packages/eslint-config`     | 基于 Antfu 的共享 ESLint 配置                          |
| `packages/typescript-config` | 共享 tsconfig                                          |
| `deploy/`                    | 静态站点的 Nginx 配置（含 CSP）与 Caddy 网关           |
| `docs/`                      | 产品需求文档                                           |

技术栈：Vue 3.5、Vite 8、TypeScript 6、Tailwind CSS 4、shadcn-vue（reka-ui）、`@lucide/vue`；PDF 预览用 `pdfjs-dist`，导出用 `@cantoo/pdf-lib`。共享依赖的版本写在根 `pnpm-workspace.yaml` 的 `catalog:` 中。

## 环境与安装

- Node.js **24.22 或更高版本**（Windows 上较早的 24.x 运行 Vitest 时子进程可能随机崩溃，退出码 0xC0000409）。
- pnpm **11.25.0**，由根 `package.json` 的 `packageManager` 固定。
- 从仓库根目录安装依赖，所有工作区共用根锁文件：

```sh
pnpm install --frozen-lockfile
```

新增或修改依赖后运行 `pnpm install` 更新根锁文件。工作区对新发布依赖设置了 24 小时等待期，允许执行的依赖构建脚本列在根 `pnpm-workspace.yaml`。

## 检查与测试

| 命令                 | 覆盖范围                      |
| -------------------- | ----------------------------- |
| `pnpm lint`          | 所有提供 `lint` 脚本的工作区  |
| `pnpm check-types`   | 所有提供类型检查的工作区      |
| `pnpm test`          | 单元/组件测试，运行一次后退出 |
| `pnpm test:coverage` | 同上的覆盖率报告              |
| `pnpm build`         | 应用构建；共享包直接导出源码  |

代码变更后运行对应工作区的 `pnpm -C <目录> lint:fix`（Antfu ESLint，同时负责格式化）。修改 `packages/ui` 或 `packages/utils` 后需同时验证 `apps/web`。

CI 为 `.github/workflows/ci.yml`：推送 main 和 PR 时运行 lint、类型检查、测试与构建。依赖更新由 Renovate（`renovate.json`）发起；PDF 相关库（`pdfjs-dist`、`@cantoo/pdf-lib`）处理不可信文件，更新不受每周排期限制。

## 部署

产物为纯静态文件，可部署到任意静态托管（Nginx、Caddy、Cloudflare Pages 等）。自托管时：

- `deploy/nginx/spa.conf`：SPA 回退、哈希资源长期缓存、`/pdfjs/` 资源缓存。
- `deploy/nginx/security-headers.conf`：内容安全策略。除站点自身外不允许任何来源，保证 PDF 与签名数据不会被发往第三方。
- `deploy/Caddyfile`：自动 HTTPS 网关，域名取自环境变量 `SITE_DOMAIN`。

托管平台不读取 Nginx 配置时，需在平台上配置等效的响应头。

## 开发指引

开始修改前阅读根目录 `AGENTS.md`。

- [共享 UI](packages/ui/README.md)、[共享工具](packages/utils/README.md)、[ESLint 配置](packages/eslint-config/README.md)
