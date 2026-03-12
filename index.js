#!/usr/bin/env node
import { buildConfig, getEnvFileStatus } from "./lib/config.js";
import { createApiClient } from "./lib/api-client.js";
import { createSyncRunner, formatStatusText } from "./lib/sync.js";
import { readLastSyncState } from "./lib/state.js";

function resolveCommandLabel(channel) {
  return channel === "discord" ? "/echomemory" : "/echo-memory";
}

export default {
  id: "echo-memory-cloud-openclaw-plugin",
  name: "Echo Memory Cloud OpenClaw Plugin",
  description: "Sync OpenClaw local markdown memory files to Echo cloud",
  kind: "lifecycle",

  register(api) {
    const cfg = buildConfig(api.pluginConfig);
    const client = createApiClient(cfg);
    const syncRunner = createSyncRunner({
      api,
      cfg,
      client,
    });

    const envStatus = getEnvFileStatus();
    if (!envStatus.found) {
      api.logger?.warn?.(
        `[echo-memory] No .env file found in ${envStatus.searchPaths.join(", ")}. Using plugin config or process env.`,
      );
    }

    api.registerService({
      id: "echo-memory-cloud-openclaw-sync",
      start: async (ctx) => {
        await syncRunner.initialize(ctx.stateDir);
        if (!cfg.autoSync) {
          api.logger?.info?.("[echo-memory] autoSync disabled");
          return;
        }

        await syncRunner.runSync("startup").catch((error) => {
          api.logger?.warn?.(`[echo-memory] startup sync failed: ${String(error?.message ?? error)}`);
        });

        syncRunner.startInterval();
      },
      stop: async () => {
        syncRunner.stopInterval();
      },
    });

    api.registerCommand({
      name: "echo-memory",
      description: "Sync OpenClaw markdown memories to Echo cloud.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const args = (ctx.args ?? "").trim();
        const [action = "status"] = args.split(/\s+/).filter(Boolean);
        const commandLabel = resolveCommandLabel(ctx.channel);

        if (action === "help") {
          return {
            text: [
              "Echo Memory commands:",
              "",
              `${commandLabel} status`,
              `${commandLabel} sync`,
              `${commandLabel} whoami`,
              `${commandLabel} help`,
            ].join("\n"),
          };
        }

        if (action === "whoami") {
          const whoami = await client.whoami();
          return {
            text: [
              "Echo identity:",
              `- user_id: ${whoami.user_id}`,
              `- token_type: ${whoami.token_type}`,
              `- scopes: ${Array.isArray(whoami.scopes) ? whoami.scopes.join(", ") : "(none)"}`,
            ].join("\n"),
          };
        }

        if (action === "sync") {
          const result = await syncRunner.runSync("manual");
          return { text: formatStatusText(result) };
        }

        const [localState, remoteStatus] = await Promise.all([
          readLastSyncState(syncRunner.getStatePath()),
          client.getImportStatus().catch(() => null),
        ]);

        return {
          text: formatStatusText(localState, remoteStatus),
        };
      },
    });
  },
};
