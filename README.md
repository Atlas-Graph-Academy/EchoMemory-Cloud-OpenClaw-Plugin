# Echo Memory Cloud OpenClaw Plugin

Markdown-only v1 plugin for syncing OpenClaw local memory files into Echo cloud storage.

## What It Does

- validates an Echo API key against Echo backend
- scans top-level `.md` files in the configured memory directory
- hashes file content and sends batches to the backend import endpoint
- runs on a schedule
- exposes manual slash commands for sync, status, and auth checks

## Required Config

- `baseUrl`: Echo backend base URL, for example `https://your-echo-host.com`
- `apiKey`: Echo API key starting with `ec_`

Optional:

- `memoryDir`: absolute path to the markdown memory directory
- `autoSync`: default `true`
- `syncIntervalMinutes`: default `15`
- `batchSize`: default `10`
- `requestTimeoutMs`: default `300000`

Path resolution order:

1. `plugins.entries.echo-memory-cloud-openclaw-plugin.config.memoryDir`
2. `ECHOMEM_MEMORY_DIR`
3. default `~/.openclaw/workspace/memory`

The same values can also be provided through runtime `.env` files under:

- `~/.openclaw/.env`
- `~/.moltbot/.env`
- `~/.clawdbot/.env`

Supported environment variables:

- `ECHOMEM_BASE_URL`
- `ECHOMEM_API_KEY`
- `ECHOMEM_MEMORY_DIR`
- `ECHOMEM_AUTO_SYNC`
- `ECHOMEM_SYNC_INTERVAL_MINUTES`
- `ECHOMEM_BATCH_SIZE`
- `ECHOMEM_REQUEST_TIMEOUT_MS`

Example `~/.openclaw/.env`:

```env
ECHOMEM_BASE_URL=http://localhost:3000
ECHOMEM_API_KEY=ec_your_key_here
ECHOMEM_MEMORY_DIR=C:\Users\your-user\.openclaw\workspace\memory
ECHOMEM_AUTO_SYNC=false
ECHOMEM_SYNC_INTERVAL_MINUTES=15
ECHOMEM_BATCH_SIZE=10
ECHOMEM_REQUEST_TIMEOUT_MS=300000
```

Example OpenClaw config override:

```json5
{
  plugins: {
    entries: {
      "echo-memory-cloud-openclaw-plugin": {
        enabled: true,
        config: {
          baseUrl: "http://localhost:3000",
          apiKey: "ec_your_key_here",
          memoryDir: "C:\\Users\\your-user\\.openclaw\\workspace\\memory",
        },
      },
    },
  },
}
```
