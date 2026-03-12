# Echo Memory Cloud OpenClaw Plugin

Markdown-only v1 plugin for syncing OpenClaw local memory files from `~/.openclaw/workspace/memory` into Echo cloud storage.

## What It Does

- validates an Echo API key against Echo backend
- scans top-level `.md` files in `~/.openclaw/workspace/memory`
- hashes file content and sends batches to the backend import endpoint
- runs on a schedule
- exposes manual slash commands for sync, status, and auth checks

## Required Config

- `baseUrl`: Echo backend base URL, for example `https://your-echo-host.com`
- `apiKey`: Echo API key starting with `ec_`

Optional:

- `autoSync`: default `true`
- `syncIntervalMinutes`: default `15`
- `batchSize`: default `10`
- `requestTimeoutMs`: default `300000`

The same values can also be provided through `.env` files under:

- `~/.openclaw/.env`
- `~/.moltbot/.env`
- `~/.clawdbot/.env`

Supported environment variables:

- `ECHOMEM_BASE_URL`
- `ECHOMEM_API_KEY`
- `ECHOMEM_AUTO_SYNC`
- `ECHOMEM_SYNC_INTERVAL_MINUTES`
- `ECHOMEM_BATCH_SIZE`
- `ECHOMEM_REQUEST_TIMEOUT_MS`
