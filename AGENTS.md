# Repository guidance

InkSign (墨签) is a browser-only PDF visual-signature tool. The product spec is `docs/InkSign_PRD_v1.2.md`; read the relevant FR sections before implementing a feature, and keep the spec in sync when a decision changes.

## Product invariants

These come from the PRD and must hold for every change:

- No backend. Nothing the user opens or creates is sent over the network: PDFs, file names, signatures and dates stay in the browser. Do not add API clients, analytics SDKs or third-party CDNs (fonts, icons and PDF.js assets are self-hosted).
- PDFs and file names are never persisted (no localStorage, IndexedDB, Cache Storage). Signatures are persisted only when the user explicitly saves them to the signature library (FR-08), optionally encrypted with a PIN through Web Crypto.
- The output is a visual signature, not a certificate-based digital signature. UI copy must never claim legal validity or tamper protection.
- Preview uses `pdfjs-dist`, export uses `@cantoo/pdf-lib` (the maintained pdf-lib fork; do not add the original `pdf-lib`). Export always re-composes from the original bytes kept in memory.
- Coordinates are stored as ratios of the visible (rotated, CropBox) viewport and mapped back with the algorithm in PRD §6. Any change to that mapping needs the rotation/CropBox fixture tests.
- Only add dependencies that are actively maintained; ask before adding any new dependency.

## Workspace boundaries

- Use Node.js >=24.22 and root-pinned pnpm 11.25.0 (older 24.x on Windows randomly kills Vitest forks with native exit 0xC0000409, reported as "Worker exited unexpectedly"). Install from the root with `pnpm install --frozen-lockfile`; dependency edits update the single root lockfile. Root workspace settings enforce a 24-hour minimum release age and list the dependency build scripts that may run (`allowBuilds`).
- Workspace globs are `apps/*` and `packages/*`. The app is `apps/web` (Vue 3 + Vite + Pinia, layout in PRD §13). It has no router: the home view and the editor workspace are switched by state.
- PDF.js goes through `apps/web/src/services/pdfjs.ts` only (worker URL and asset URLs), and always as the legacy build (`pdfjs-dist/legacy/build/*`): the modern build needs very recent APIs such as `Uint8Array.prototype.toHex`, missing in older Safari/iOS, WeChat's built-in browser and Node 24. ESLint (`ts/no-restricted-imports`) rejects value imports from `pdfjs-dist` and `pdfjs-dist/build/*`; type imports are fine. Its runtime assets (`cmaps`, `standard_fonts`, `wasm`, `iccs`) are copied from the installed `pdfjs-dist` into the git-ignored `apps/web/public/pdfjs/` by the `inksign:pdfjs-assets` plugin in `vite.config.ts` on every dev/build start; never commit or hand-edit them. Load PDF.js and `@cantoo/pdf-lib` lazily (dynamic `import()`) from the editor, not from the home view.
- The repository is Vue-only: there is no React code.
- Shared code lives in Just-in-Time packages that export source directly (no build step, no TypeScript `paths` used by their sources):
  - `@repo/ui` (`packages/ui`): shadcn-vue components (`@repo/ui/components/<name>`), `cn` (`@repo/ui/lib/utils`) and the shared Tailwind 4 setup (`@repo/ui/styles/theme.css`). Component sources import each other with relative paths and are excluded from ESLint to stay diffable against upstream.
  - `@repo/utils` (`packages/utils`): framework-agnostic helpers (`cn`, `isExternalUrl`, `applyThemeClass`) with Vitest tests.
  - `@repo/eslint-config` (Antfu-based `defineConfig`) and `@repo/typescript-config` (`base.json`).
- Versions shared by more than one workspace (vue, vite, tailwindcss, reka-ui, typescript, vue-tsc, eslint, vitest, ...) live in the root `pnpm-workspace.yaml` `catalog:`; reference them as `catalog:` and add new shared versions there by hand. `@repo/eslint-config` sets `pnpm: { catalogs: false }`, otherwise Antfu's `pnpm/json-enforce-catalog` forces every dependency into the catalog and rewrites `pnpm-workspace.yaml` even without `--fix`.

## Commands and verification

Run these from the repository root; directory targeting avoids guessing package names.

| Scope | Development           | Focused verification                                                                                    |
| ----- | --------------------- | ------------------------------------------------------------------------------------------------------- |
| Web   | `pnpm dev:web` (5020) | `pnpm -C apps/web lint:fix`, `pnpm -C apps/web build` (includes Vue typecheck), `pnpm -C apps/web test` |
| UI    | —                     | `pnpm -C packages/ui lint`, `pnpm -C packages/ui check-types`                                           |
| Utils | —                     | `pnpm -C packages/utils lint:fix`, `pnpm -C packages/utils check-types`, `pnpm -C packages/utils test`  |

- Root `lint`, `check-types`, `test`, `test:coverage` and `build` run through Turbo over every workspace that defines the script. Typechecks and tests bypass Turbo cache; builds cache `dist/**`.
- All tests use Vitest from the root catalog. Tests live in `src/**/__tests__/*.test.ts` and opt into DOM with `// @vitest-environment happy-dom`. Single test: `pnpm -C packages/utils test src/__tests__/theme.test.ts`.
- Web test support lives in `apps/web/tests/`: `fixtures/pdf-fixtures.ts` builds the PDF samples in memory (rotations, offset boxes, UserUnit, leaked CTM, mixed pages; add a fixture for every new PDF quirk), `helpers/drawn-images.ts` replays a page's operator list with PDF.js to find where images actually land, `helpers/png.ts` encodes test PNGs without canvas. `apps/web/tsconfig.test.json` gives tests (and only tests) Node types. `pnpm -C apps/web samples:pdf` writes samples and signed exports to the git-ignored `apps/web/tests/fixtures/out/` for checking in real viewers.
- Lint and formatting use `@repo/eslint-config` (Antfu ESLint; `lint:fix` also formats). Root `format` (Prettier) respects `.prettierignore`, which skips the workspaces formatted by ESLint.
- Changes to `packages/ui` or `packages/utils` must also be verified in `apps/web` (lint, build, test).
- Core logic (`services/`, `composables/`, `stores/`, coordinate mapping, signature-library crypto) requires tests updated and run in the same change.
- New shadcn-vue components: run the CLI inside `packages/ui` (its `components.json` aliases point at `@repo/ui/*`), then rewrite generated `@repo/ui/...` imports to relative paths and add any new third-party dependency to `packages/ui/package.json`.
- CI is `.github/workflows/ci.yml` (push to main, PRs): `pnpm lint`, `check-types`, `test`, `build`. Dependency updates come from Renovate (`renovate.json`, waits 1 day to match `minimumReleaseAge`; PDF libraries are not held to the weekly schedule).
- Deployment is a static site. `deploy/nginx/spa.conf` serves it, `deploy/nginx/security-headers.conf` holds the Content-Security-Policy from PRD §8 (only `'self'`, plus `'wasm-unsafe-eval'` for PDF.js decoders), `deploy/Caddyfile` is the HTTPS gateway. Adding any external origin breaks the privacy promise; change the PRD first if it is ever needed.

<!-- BEGIN:turborepo-agent-rules -->

# This is NOT the Turborepo you know

Turborepo configuration, task behavior, and CLI commands can vary between installed versions and may differ from your training data. Resolve the `turbo` package from this file's directory or relevant workspace; in monorepos, it may not be visible from the repository root. For example, run `node -p "require.resolve('turbo/package.json')"` from a workspace that depends on `turbo`.

Read `docs/README.md` inside that installed package first, then read the relevant pages from its `docs/` directory before changing Turborepo configuration or commands. Heed deprecation notices. These bundled docs match the installed package version and are available without network access.

This block is written and re-added by `turbo` before repository-scoped commands when an AI agent is detected. In the Turborepo source repository, its template is defined in `crates/turborepo-cli/src/cli/agent_guidance.rs`. Removing the managed block while updates are enabled means a later qualifying invocation will add it again. Set `"agentGuidance": true` in the root `turbo.json` or `turbo.jsonc` to opt in; this does not remove an existing block. Keep the block committed with your work to avoid an uncommitted change on the next agent invocation.
<!-- END:turborepo-agent-rules -->
