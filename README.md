# Echo Memory Cloud OpenClaw Plugin

OpenClaw plugin for syncing local markdown memories into EchoMem Cloud and making those memories retrievable from Slack through OpenClaw.

## What This Plugin Does

- scans top-level `.md` files from your OpenClaw memory directory
- syncs markdown content into EchoMem Cloud
- exposes manual commands for status, identity, sync, and search
- registers an `echo_memory_search` tool so OpenClaw can use EchoMem during normal Slack conversations
- adds Slack prompt guidance so memory retrieval can happen naturally on memory-dependent turns

## What This Plugin Does Not Do

- it does not auto-sync memories unless you enable it or manually trigger it
- it does not force memory search on every Slack message

The plugin runs inside OpenClaw. The only external service it needs is an EchoMem backend reachable at `baseUrl`.

## Before You Begin

You need an EchoMemory account and an API key before this plugin can sync or search anything.

1. Sign up for an EchoMemory account at `http://iditor.com/signup/openclaw`
2. Generate an API key at `https://www.iditor.com/api`
3. Use that API key in the plugin config as `apiKey`

Recommended API key scopes:

- `ingest:write` for markdown sync
- `memory:read` for retrieval and `/echo-memory search`

## Base URL

`baseUrl` should point to the EchoMemory service endpoint.

Use the deployed backend for normal usage:

```json
"baseUrl": "https://echo-mem-chrome.vercel.app"
```

If OpenClaw prints `plugin not found: echo-memory-cloud-openclaw-plugin`, that is an installation problem, not a `baseUrl` problem.

## Required Config

- `baseUrl`: EchoMem backend base URL
- `apiKey`: EchoMemory API key starting with `ec_`

Optional config:

- `memoryDir`: absolute path to the markdown memory directory
- `webBaseUrl`: Echo web app base URL for public graph links, default `https://www.iditor.com`
- `autoSync`: default `true`
- `syncIntervalMinutes`: default `15`
- `batchSize`: default `10`
- `requestTimeoutMs`: default `300000`

Path resolution order for `memoryDir`:

1. `plugins.entries.echo-memory-cloud-openclaw-plugin.config.memoryDir`
2. `ECHOMEM_MEMORY_DIR`
3. `~/.openclaw/workspace/memory`

Supported runtime `.env` locations:

- `~/.openclaw/.env`
- `~/.moltbot/.env`
- `~/.clawdbot/.env`

Supported environment variables:

- `ECHOMEM_BASE_URL`
- `ECHOMEM_WEB_BASE_URL`
- `ECHOMEM_API_KEY`
- `ECHOMEM_MEMORY_DIR`
- `ECHOMEM_AUTO_SYNC`
- `ECHOMEM_SYNC_INTERVAL_MINUTES`
- `ECHOMEM_BATCH_SIZE`
- `ECHOMEM_REQUEST_TIMEOUT_MS`

Example `~/.openclaw/.env`:

```env
ECHOMEM_BASE_URL=https://echo-mem-chrome.vercel.app
ECHOMEM_WEB_BASE_URL=https://www.iditor.com
ECHOMEM_API_KEY=ec_your_key_here
ECHOMEM_MEMORY_DIR=C:\Users\your-user\.openclaw\workspace\memory
ECHOMEM_AUTO_SYNC=false
ECHOMEM_SYNC_INTERVAL_MINUTES=15
ECHOMEM_BATCH_SIZE=10
ECHOMEM_REQUEST_TIMEOUT_MS=300000
```

Example `openclaw.json` config:

```json5
{
  "channels": {
    "slack": {
      "mode": "socket",
      "enabled": true,
      "groupPolicy": "allowlist",
      "allowFrom": ["U1234567890"], // replace with your slack user id
      "channels": {
        "C0123456789": { "allow": true }, // replace with your slack channel id
      },
    },
  },
  "plugins": {
    "entries": {
      "echo-memory-cloud-openclaw-plugin": {
        "enabled": true,
        "config": {
          "baseUrl": "https://echo-mem-chrome.vercel.app",
          "webBaseUrl": "https://www.iditor.com",
          "apiKey": "ec_your_key_here",
          "memoryDir": "C:\\Users\\your-user\\.openclaw\\workspace\\memory", // tweak it based on Mac or Windows environment
          "autoSync": false,
          "syncIntervalMinutes": 15,
          "batchSize": 10,
          "requestTimeoutMs": 300000,
        },
      },
    },
  },
}
```

## Installation

### Install from a local path

On Windows, quote the path if your username or folders contain spaces:

```powershell
openclaw plugins install "C:\Users\Your Name\Documents\GitHub\EchoMemory-Cloud-OpenClaw-Plugin"
```

If you are actively editing this repo and want OpenClaw to pick up changes directly, install it as a link:

```powershell
openclaw plugins install --link "C:\Users\Your Name\Documents\GitHub\EchoMemory-Cloud-OpenClaw-Plugin"
```

After installation:

1. restart `openclaw gateway`
2. keep the plugin config entry in `~/.openclaw/openclaw.json`
3. point `baseUrl` to the real EchoMem backend you want to use

### Successful load looks like this

These lines indicate the plugin was loaded successfully:

- OpenClaw discovered the plugin path
- `[echo-memory] No .env file found ... Using plugin config or process env.`
- `[echo-memory] autoSync disabled` or normal sync startup logs

This warning is not fatal by itself:

- `plugins.allow is empty; discovered non-bundled plugins may auto-load`

## Slack Authorization

If Slack replies with `This command requires authorization`, the plugin is loaded but OpenClaw is blocking the command.

The usual fix is to authorize your Slack user ID in one of these places:

- `channels.slack.allowFrom`
- `channels.slack.channels.<channelId>.users`

Example:

```json5
{
  "channels": {
    "slack": {
      "groupPolicy": "allowlist",
      "allowFrom": ["U1234567890"],
      "channels": {
        "C0123456789": {
          "allow": true,
        },
      },
    },
  },
}
```

For a narrow per-channel allowlist:

```json5
{
  "channels": {
    "slack": {
      "channels": {
        "C0123456789": {
          "allow": true,
          "users": ["U1234567890"],
        },
      },
    },
  },
}
```

After changing Slack auth config, restart `openclaw gateway`.

## Commands

- `/echo-memory status`
- `/echo-memory sync`
- `/echo-memory whoami`
- `/echo-memory search <query>`
- `/echo-memory graph`
- `/echo-memory graph public`
- `/echo-memory onboard`
- `/echo-memory onboard <topic>`
- `/echo-memory help`

Graph link behavior:

- `/echo-memory graph` opens `https://www.iditor.com/login?next=/memory-graph` so you log in again before accessing your private personal memory graph
- `/echo-memory graph public` opens the shared public memories page at `https://www.iditor.com/memories`

Onboarding behavior:

- `/echo-memory onboard` returns the full setup and usage guide
- `/echo-memory onboard signup|setup|commands|graph|operations|troubleshooting` returns focused help
- natural-language setup questions can also trigger the onboarding tool during normal chat

Recommended Slack smoke test order:

1. `/echo-memory whoami`
2. `/echo-memory status`
3. `/echo-memory sync`
4. `/echo-memory search <known memory topic>`

In channels, you may need to mention the bot depending on your Slack/OpenClaw setup:

```text
@OpenClaw /echo-memory whoami
@OpenClaw /echo-memory search project timeline
```

## Natural Retrieval In Chat

When the plugin is loaded, it registers an `echo_memory_search` tool and appends prompt guidance for Slack conversations.

Normal chat retrieval works like this:

1. a Slack message arrives
2. OpenClaw builds the prompt
3. the plugin tells the model that EchoMem search is available
4. the model decides whether to call `echo_memory_search`
5. if it calls the tool, EchoMem retrieval happens before the final reply

This means:

- `/echo-memory search ...` is deterministic manual retrieval
- normal chat retrieval is automatic but model-driven
- memory search is not forced on every Slack message

Good test prompt:

```text
@OpenClaw what do you remember about my notes on <topic>?
```

Weak test prompt:

```text
@OpenClaw hi
```

If prompt injection is disabled in OpenClaw plugin settings, manual search will still work, but the model will be less likely to use memory automatically in normal chat.

## Search Behavior

Retrieval is semantic, not raw full-text matching.

That means:

- searching by topic or meaning usually works better than copying an exact phrase from markdown
- `/echo-memory search` may return zero results if the query is too literal or too narrow
- normal chat retrieval uses the same memory search path as the manual command

## Troubleshooting

### `plugin not found: echo-memory-cloud-openclaw-plugin`

OpenClaw cannot find the installed plugin package yet.

Check:

1. the plugin is actually installed
2. the install path is quoted on Windows
3. you restarted `openclaw gateway` after install

### `error: too many arguments for 'install'`

Your Windows path probably contains a space and was not quoted.

Use:

```powershell
openclaw plugins install "C:\Users\Your Name\Documents\GitHub\EchoMemory-Cloud-OpenClaw-Plugin"
```

### Repo edits are not taking effect

You may have installed a copied plugin instead of a linked plugin.

Use:

```powershell
openclaw plugins install --link "C:\Users\Your Name\Documents\GitHub\EchoMemory-Cloud-OpenClaw-Plugin"
```

If a copied install already exists, uninstall it first or remove the stale extension directory before linking.

### Slack says `This command requires authorization`

The fix is in OpenClaw Slack auth config, not in this plugin.

Add your Slack member ID to `channels.slack.allowFrom` or the channel-specific `users` list, then restart the gateway.

### `/echo-memory search` returns no results

Check these in order:

1. confirm the API key has `memory:read` or `mcp:tools`
2. confirm the memories were actually imported with `/echo-memory status` and backend inspection
3. try searching by topic or meaning, not only by a literal copied phrase
4. if the problem persists, ask the service maintainer whether the deployed EchoMemory service is up to date

### `.../rest/v1/api_keys 400`

This can be normal in older Supabase schema setups.

EchoMem first tries to read `api_keys.scopes`. If that optional column does not exist, PostgREST may return `400`, then the code falls back to the legacy query. If the actual route continues and returns search or sync results, this `400` is not the root failure.

### Timestamps do not match markdown filenames

This plugin sends the markdown filename and title information needed for date-based imports.

Expected behavior:

- embedded `YYYY-MM-DD` values in markdown titles or basenames should be used as the stored creation date
- this should apply even if the filename contains other words around the date

If your imported timestamps still match import time instead of the markdown date, contact the EchoMemory service maintainer.
