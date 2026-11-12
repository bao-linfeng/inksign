# `@repo/utils`

monorepo 共享工具函数库，框架无关，供 `@repo/ui` 与 `apps/web` 使用。包直接导出 TypeScript 源码，无独立构建步骤。

## 使用方式

```ts
import { applyThemeClass, cn, isExternalUrl } from '@repo/utils'
```

## 导出 API

### `cn(...inputs)`

合并 Tailwind CSS 类名，基于 `clsx` + `tailwind-merge`，处理条件类名和冲突覆盖。

```ts
cn('px-2 py-1', condition && 'bg-blue-500', 'px-4')
// → 'py-1 bg-blue-500 px-4'（px-4 覆盖 px-2）
```

### `isExternalUrl(url)`

判断 URL 是否为外部链接（以 `http://`、`https://` 或 `//` 开头）。

```ts
isExternalUrl('https://example.com') // → true
isExternalUrl('/about') // → false
```

### `applyThemeClass(theme, element?)`

将主题名应用到指定元素（默认为 `document.documentElement`）。移除所有已有的 `theme-*` class，再添加 `theme-${theme}`，保留 `dark` 等其他 class。传入不带 `theme-` 前缀的主题名；该函数需要 DOM。

```ts
applyThemeClass('blue') // 添加 theme-blue
applyThemeClass('green', document.body) // 在 body 上切换到 theme-green
```

## 开发

使用根目录的 Node.js 24.22+ / pnpm 11.25.0 环境安装依赖：`pnpm install --frozen-lockfile`。以下命令在仓库根目录运行：

```bash
pnpm -C packages/utils lint:fix
pnpm -C packages/utils check-types
pnpm -C packages/utils test
pnpm -C packages/utils test:watch
pnpm -C packages/utils test:coverage
```

修改此包后，`apps/web` 也需要运行 build 验证。

## 依赖

- `cn`：clsx + tailwind-merge 封装

## 测试

测试文件位于 `src/__tests__/`，使用 Vitest + happy-dom（需要 DOM 的用例通过 `// @vitest-environment happy-dom` 注释声明）。
