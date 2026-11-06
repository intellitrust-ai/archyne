# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Archyne is a visual editor for Mermaid diagrams with two-way sync between canvas and text. It is the same static Vite/React build shipped four ways: web (`dist/`), `npx archyne` (`bin/archyne.mjs`), an Electron shell (`desktop/`), and a VS Code extension (`extensions/vscode/`). There is no backend. Node ≥ 22.12 is required.

`CONTRIBUTING.md` is the authoritative contributor guide; read it before larger changes.

## Commands

```sh
npm run dev                 # Vite dev server, http://localhost:5173
npm test                    # Vitest (jsdom) — all unit tests
npx vitest run src/model/roundtrip.test.ts          # one file
npx vitest run src/model/roundtrip.test.ts -t "er"  # tests matching a name
npm run typecheck           # tsconfig.json (src, browser) + tsconfig.node.json (Node code)
npm run lint                # ESLint; jsx-a11y rules are errors
npm run format              # Prettier (CI runs format:check)
npm run build && npm run size   # production build + initial-load bundle budget
npm run mcp:smoke           # spawns the MCP server and exercises every tool
npm run audit               # high/critical advisories in production deps only
```

Other CI gates worth running when touching the relevant area:

- `npm run boxmodel:check` — `src/render/boxModel.generated.ts` must match `src/styles.css`. After editing node padding/fonts/colours in CSS, run `npm run boxmodel`.
- `npm run size:render` — the renderer (`src/render/`) must never import React, xyflow, Zustand, Mermaid or the Iconify collections.
- `npm run notices:check` — `THIRD-PARTY-NOTICES.md` must match production deps (`npm run notices:update` after changing dependencies).
- `node extensions/vscode/scripts/sync-version.mjs --check` and `node packages/render/scripts/sync-version.mjs --check` — the extension and `archyne-render` versions are derived from the root `package.json`; never bump them by hand.

### Browser (Playwright) suites

`tests/e2e-*.mts`, run with `npm run test:e2e:<name>` (see `package.json`). Start `npm run dev` first; they target `ARCHYNE_URL` (default: the dev server) and need `window.__graphTest`, which `src/App.tsx` exposes only under `import.meta.env.DEV`. Exceptions: `test:e2e:csp` runs against `npm run preview` (production build), and `test:e2e:render` opens no app at all. `PLAYWRIGHT_CHANNEL=msedge` uses installed Edge. jsdom has no layout, so anything about geometry, contrast, export rasterization, pointer gestures or mermaid's sanitizer belongs in these, not in Vitest.

## Architecture

**The Mermaid text is the source of truth.** The canvas is a view over it: every structural edit regenerates the text, and the text is re-parsed to rebuild the canvas. Undo is a snapshot stack of text; LLM edits need no special handling.

- `src/model/` — the text ↔ graph contract. `diagram.ts` (`parseDiagram` / `serializeDiagram`) dispatches on diagram kind to `kinds/<kind>.ts` (flowchart, sequence, state, class, er, c4, architecture, requirement — SysML's `requirementDiagram`; in that family a node's name _is_ its id, so `renameRequirements` in `store.ts` renames the edges with it). `from*.ts` are importers for foreign formats (draw.io, Visio, Lucid, Excalidraw, DOT, PlantUML, SQL DDL) that produce Mermaid; `sniff.ts` detects the format.
- `src/model/positions.ts` / `waypoints.ts` — manual layout and hand-routed edges live in trailing `%% graph:positions {...}` and `%% graph:waypoints` comments, so the file stays valid Mermaid. `carryOver*` keeps layout for surviving nodes when something (an LLM, the MCP server) rewrites the diagram without those lines.
- `src/store.ts` — Zustand store: edits, selection, undo/redo, clipboard.
- `src/components/` — React UI on `@xyflow/react` (canvas, palette, inspector, CodeMirror code panel, dialogs).
- `src/layout/` — ELK auto-layout. Routing/geometry helpers (`routing.ts`, `orthogonal.ts`, `avoid.ts`, `measureNode.ts`, `textMetrics.ts`, …) sit at the top of `src/`.
- `src/render/` — DOM-free SVG renderer, published separately as `archyne-render` (`packages/render/` builds it). It must stay free of React/Mermaid/xyflow; shared constants (e.g. `actorPath.ts`, `boxModel.ts`) live here so the canvas and the renderer draw the same thing.
- `src/embed.ts` / `src/host.ts` — `postMessage` bridge for host pages and the VS Code webview; `host.ts` decides who owns the document.
- `src/ai/` — "Generate" (see `docs/generate.md`): user-chosen OpenAI-compatible local server or remote provider; the remote path is desktop/VS Code only.
- `mcp/server.ts` — stdio MCP server over `.mmd` files under `GRAPH_DIR`; writes are parser-validated and carry over positions. It imports `src/model` directly under a JSDOM shim.
- `desktop/` — Electron main process (CommonJS). `extensions/vscode/` — `CustomTextEditorProvider` that ships the built `dist/` (build the app first) and rewrites the page for the webview in `src/rewrite.ts`; CSP changes in `index.html` must keep `rewrite.test.ts` green.

Public API (semver-relevant, see `CHANGELOG.md`): the `.mmd` comment format, the embed protocol in `src/embed.ts`, MCP tool names/schemas, and `archyne-render` entry points.

## Invariants and conventions

- **Round-trip:** a diagram that is parsed and serialized must come back byte-identical apart from the positions line. Any parser/serializer change needs a fixture update in `src/model/roundtrip.test.ts`. Adding a diagram kind: `DiagramKind` in `src/model/types.ts` → `src/model/kinds/<kind>.ts` → register in `diagram.ts` → palette, inspector, `NEW_DIAGRAM` template → round-trip tests.
- **i18n:** every user-visible string goes through `src/i18n/en.ts` via `useT()` (components) or `t()`; no literal English in JSX. Rules, deliberate exceptions and RTL in `docs/i18n.md`.
- **Accessibility:** clickable things are `<button>`s; icon-only controls need `aria-label`; every pointer action needs a keyboard path (`src/placement.ts`, `useKeyboardConnect.ts`); dialogs use `src/components/Modal.tsx`; `autoFocus` is disallowed except on a just-opened inline editor.
- **Bundle budget:** initial load is budgeted (`bundle-budget.json`). Heavy things (Mermaid renderers, Iconify collections, ELK, Transformers.js) must be dynamic imports. Palette search reads `src/icon-names.generated.json` and must never import `@iconify-json/*`; regenerate with `npm run icons:index` and keep `COLLECTIONS` in `scripts/build-icon-index.mjs` in sync with `LOADERS` in `src/icons.ts`. Intentional growth: `node scripts/check-bundle-size.mjs --update` and explain it in the PR.
- **Generated files** (`*.generated.*`) are not edited by hand; change the source and rerun the matching script.
- `tests/sourceHygiene.test.ts` fails on any invisible C0 control character in source — use escapes.
- Style: short comments that explain _why_. Update `CHANGELOG.md` under `## [Unreleased]` for user-visible changes. Commit subjects are short and imperative.
