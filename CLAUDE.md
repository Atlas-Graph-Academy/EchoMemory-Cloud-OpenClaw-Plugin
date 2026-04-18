# EchoMemory-Cloud-OpenClaw-Plugin — Project Context & Rules

## 1. What this is

An OpenClaw plugin that scans local markdown memories from `~/.openclaw/workspace/`,
classifies each file by privacy risk, and syncs safe ones to Echo cloud. Ships with
a local React UI served over HTTP so users can inspect/decide what to upload.

Two runtimes in one repo:
- **Node plugin** (`index.js` + `lib/*.js`) — runs inside the OpenClaw gateway process.
  Exposes an HTTP API on port **17823** and a sync runner.
- **React local UI** (`lib/local-ui/`) — Vite app that talks to `/api/*` on the gateway.

## 2. Architecture map — DO NOT grep, READ these directly

### Plugin (Node, runs in OpenClaw gateway)
- **Entrypoint:** `index.js` — exports `register(api)`, wires everything together
- **HTTP API + request handler:** `lib/local-server.js` — every `/api/*` endpoint
- **Sync pipeline:** `lib/sync.js` — `createSyncRunner`, `runSync`, stamping state
- **Echo cloud client:** `lib/api-client.js` — `whoami`, `importMarkdown`, `listAllSources`, `verifyOtp`. Caches `lastKnownUserId` for account-switch detection.
- **File scanner + risk classifier:** `lib/openclaw-memory-scan.js` — `scanFullWorkspace`, `scanWorkspaceMarkdownFile`, `classifyFile`. Emits `riskLevel: "secret" | "private" | "safe"`.
- **Credential text detector:** `lib/sensitive-field-scan.js` — precision-focused token/key regexes. SECRET only; no PII.
- **Sync-state file I/O:** `lib/state.js` — `readLastSyncState`, `writeLastSyncState`, `clearLastSyncState`
- **Config / env file:** `lib/config.js` — reads/writes `~/.openclaw/.env`
- **Markdown cluster inference:** `lib/markdown-structure-cluster.js` — legacy content-cluster classifier (JOURNAL/TECHNICAL/etc), used by canvas
- **Onboarding:** `lib/onboarding.js`
- **Plugin manifests:** `{openclaw,moltbot,clawdbot}.plugin.json` — same code, three registration targets. Kept in sync by `scripts/sync-version.js`.

### Local UI (React + Vite, served on 5173 in dev, proxied to 17823)
- **Top-level shell:** `lib/local-ui/src/App.jsx`
- **Canvas (spatial view):** `lib/local-ui/src/canvas/Viewport.jsx` + `useCanvas.js` (pan/zoom)
- **List / directory view:** `lib/local-ui/src/list/ListView.jsx` — default landing view, risk-banded
- **Layout engine:** `lib/local-ui/src/layout/masonry.js` — `computeLayout` (cluster bands, legacy) + `computeRiskLayout` (risk bands, current default)
- **File cards:** `lib/local-ui/src/cards/Card.jsx` + `ReadingPanel.jsx`
- **Frontend API bindings:** `lib/local-ui/src/sync/api.js` — one function per `/api/*` endpoint
- **SSE stream handler:** same file, `connectSSE`
- **Styles:** `lib/local-ui/src/styles/global.css`

### On-disk state (outside the repo)
- **Workspace (scanned):** `~/.openclaw/workspace/`
- **Sync state:** `~/.openclaw/state/echo-memory-cloud-openclaw-plugin/echo-memory-last-sync-*.json`
- **Env / API key:** `~/.openclaw/.env` → `ECHOMEM_API_KEY`, `ECHOMEM_MEMORY_DIR`

## 3. The reload loop — how to test changes

**UI-only changes** (anything under `lib/local-ui/src/`): Vite HMR handles it. Don't restart.

**Plugin / backend changes** (anything else): the gateway runs OLD code until you restart.
```
openclaw gateway restart
```
The gateway is a LaunchAgent (`gui/501/ai.openclaw.gateway`); `restart` re-execs it.

**Dev server for UI:**
```
cd lib/local-ui && npm run dev    # serves 5173, proxies /api → 127.0.0.1:17823
```

**UI production build:**
```
cd lib/local-ui && npm run build
```
Output goes to `lib/local-ui/dist/`; served by `local-server.js` when no Vite is running.

**Plugin loading path:** `~/.openclaw/openclaw.json` → `plugins.load.paths` points at the repo root. OpenClaw ALSO auto-scans `~/.openclaw/extensions/` and `~/.openclaw/node_modules/@echomem/` — any `.bak-*` copies there will override the configured path and fight your changes. Quarantine them in `~/.openclaw/_disabled-plugins/` if they cause a duplicate-plugin warning at restart.

## 4. Hard rules (learned in production — do not relax)

- **riskLevel vs privacyLevel are distinct.** SECRET = text-scan hit (credentials). PRIVATE = path convention (`**/private/**`, `SOUL.md`/`USER.md`/`IDENTITY.md`/`TOOLS.md`, `privacy: private` frontmatter, `private-*.md`). Never conflate in UI or sync-gating logic.
- **Sync-state files MUST be userId-stamped.** `sync.js` writes via `writeStateStamped`. Readers in `local-server.js` wipe state on mismatch. Don't bypass.
- **NEVER widen sensitive-scan rules to `longStrings` or `emails`.** That path was removed specifically because it flagged git SHAs/UUIDs/every email as "sensitive" (70+ FPs on real workspaces). Precision beats recall here.
- **NEVER edit one `*.plugin.json` without updating the others.** Run `npm run sync-version` or hand-mirror the change to all three files. They MUST agree on version.
- **Viewport pointer events get captured.** Any interactive button inside a `.canvas` or `.section-label` MUST set `onPointerDown={(e) => e.stopPropagation()}` or `useCanvas.onPointerDown` will call `setPointerCapture` and eat the click.
- **`/api/sync-status` cloud lookup has a 1-second cap.** `BACKEND_SOURCE_LOOKUP_TIMEOUT_MS` in `local-server.js`. Don't remove the `Promise.race` wrapper — a slow Echo cloud must not block the UI.
- **Don't commit `~/.openclaw/.env`, `dist/`, or `node_modules/`.** `.gitignore` already covers them; just don't work around it.
- **Local state directory gotcha:** OpenClaw runtime adds a hash suffix to the state file name (`echo-memory-last-sync-f31a44b48ca33471.json`, not `echo-memory-last-sync.json`). If you're looking for the state file, glob.

## 5. When asked to investigate a bug, start here

| Symptom | Read first |
|---|---|
| Wrong files marked sensitive | `lib/sensitive-field-scan.js` |
| Wrong privacy classification | `lib/openclaw-memory-scan.js` → `classifyFile` |
| Sync status looks stale after account switch | `lib/local-server.js` → `buildWorkspaceSyncView` (userId mismatch) |
| Sync completes but UI doesn't update | SSE handler in `lib/local-ui/src/App.jsx` `onSyncProgress` |
| CTA or section toggle on canvas doesn't fire | `lib/local-ui/src/canvas/Viewport.jsx` pointer-event propagation |
| Card animation doesn't reflect sync | `cardSyncState` plumbing in `App.jsx` → `transientStatus` prop → `Card.jsx` `card-processing` class |
| Duplicate-plugin warning at gateway start | Quarantine stale dirs under `~/.openclaw/extensions/` and `~/.openclaw/node_modules/@echomem/` |

## 6. Conventions you must follow

- **Commit style:** `feat(scope): short subject` / `fix(scope): short subject`, body with bullet list. Scope = `local-ui` for UI, omit for plugin-wide, or name the module.
- **Version bump:** edit `package.json` only; `npm version` auto-syncs the three plugin manifests via the `version` hook.
- **No new top-level `.md` files** unless explicitly asked. This file and `README.md` are the only AI-facing docs.
- **No emojis in source code** unless matching existing conventions (e.g. `SECTION_META.label` uses them intentionally).
- **Don't add runtime dependencies to the plugin** without a clear reason. It runs inside someone else's Node process; every dep is their problem too.
