# Echo Memory Cloud OpenClaw Plugin

Markdown-first plugin for syncing OpenClaw local memory files into Echo cloud storage and retrieving them during chat.

## What It Does

- validates an Echo API key against Echo backend
- scans top-level `.md` files in the configured memory directory
- hashes file content and sends batches to the backend import endpoint
- registers an agent tool so Slack conversations can search EchoMem during replies
- exposes a manual search command for quick retrieval checks
- runs on a schedule
- exposes manual slash commands for sync, status, search, and auth checks

## Required Config

- `baseUrl`: Echo backend base URL, for example `https://your-echo-host.com`
- `apiKey`: Echo API key starting with `ec_`

Recommended scopes:

- `ingest:write` for markdown sync
- `memory:read` for retrieval and `/echo-memory search`

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
          baseUrl: "https://your-echo-host.com",
          apiKey: "ec_your_key_here",
          memoryDir: "C:\\Users\\your-user\\.openclaw\\workspace\\memory",
        },
      },
    },
  },
}
```

## Commands

- `/echo-memory status`
- `/echo-memory sync`
- `/echo-memory whoami`
- `/echo-memory search <query>`
- `/echo-memory help`

## Natural Retrieval In Chat

When the plugin is loaded, it registers an `echo_memory_search` agent tool and adds prompt guidance for Slack conversations so OpenClaw can naturally pull EchoMem context before answering memory-dependent questions.

If you disable plugin prompt injection in OpenClaw config, the manual `/echo-memory search` command still works, but the agent will be less likely to use memory automatically during normal chat turns.
