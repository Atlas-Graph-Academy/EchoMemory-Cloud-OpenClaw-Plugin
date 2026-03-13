#!/usr/bin/env node
import { buildConfig, getEnvFileStatus } from "./lib/config.js";
import { createApiClient } from "./lib/api-client.js";
import { formatSearchResultsText } from "./lib/echo-memory-search.js";
import { createEchoMemorySearchTool } from "./lib/echo-memory-tool.js";
import { createSyncRunner, formatStatusText } from "./lib/sync.js";
import { readLastSyncState } from "./lib/state.js";

function resolveCommandLabel(channel) {
  return channel === "discord" ? "/echomemory" : "/echo-memory";
}

function parseCommandArgs(rawArgs) {
  const args = String(rawArgs || "").trim();
  if (!args) {
    return {
      action: "status",
      actionArgs: "",
    };
  }

  const [action = "status", ...rest] = args.split(/\s+/).filter(Boolean);
  return {
    action: action.toLowerCase(),
    actionArgs: rest.join(" ").trim(),
  };
}

function normalizePublicGraphUrl(baseUrl, slug) {
  const cleanBase = String(baseUrl || "").replace(/\/+$/, "");
  const cleanSlug = String(slug || "").replace(/^\/+/, "");
  if (!cleanBase || !cleanSlug) return "";
  return `${cleanBase}/${cleanSlug}`;
}

export default {
  id: "echo-memory-cloud-openclaw-plugin",
  name: "Echo Memory Cloud OpenClaw Plugin",
  description: "Sync and retrieve OpenClaw markdown memories through Echo cloud",
  kind: "lifecycle",

  register(api) {
    const cfg = buildConfig(api.pluginConfig);
    const client = createApiClient(cfg);
    const syncRunner = createSyncRunner({
      api,
      cfg,
      client,
    });

    api.registerTool(createEchoMemorySearchTool(client));
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.messageProvider && ctx.messageProvider !== "slack") {
        return;
      }
      return {
        appendSystemContext: [
          "EchoMem cloud retrieval is available through the `echo_memory_search` tool.",
          "Use it when the conversation asks about prior facts, plans, decisions, dates, preferences, people, or when memory context would improve accuracy.",
          "Prefer it before answering memory-dependent questions instead of guessing.",
        ].join("\n"),
      };
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
      description: "Sync and search OpenClaw markdown memories through Echo cloud.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, actionArgs } = parseCommandArgs(ctx.args);
        const commandLabel = resolveCommandLabel(ctx.channel);

        if (action === "help") {
          return {
            text: [
              "Echo Memory commands:",
              "",
              `${commandLabel} status`,
              `${commandLabel} search <query>`,
              `${commandLabel} graph`,
              `${commandLabel} graph public`,
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

        if (action === "search") {
          if (!actionArgs) {
            return {
              text: [
                "Missing search query.",
                `Usage: ${commandLabel} search <query>`,
              ].join("\n"),
            };
          }

          const payload = await client.searchMemories({
            query: actionArgs,
            similarityThreshold: 0.3,
          });
          return {
            text: formatSearchResultsText(actionArgs, payload),
          };
        }

        if (action === "graph") {
          const graphMode = String(actionArgs || "").trim().toLowerCase();

          if (!graphMode || graphMode === "private") {
            const payload = await client.createWebGraphLink();
            const expiresAt = typeof payload.expires_at === "string" ? payload.expires_at : null;
            return {
              text: [
                "Open your private memory graph:",
                String(payload.url || ""),
                expiresAt ? `Link expires at: ${expiresAt}` : null,
              ].filter(Boolean).join("\n"),
            };
          }

          if (graphMode === "public") {
            try {
              const status = await client.getPublicGraphStatus();
              if (status?.is_published && status?.slug) {
                return {
                  text: [
                    "Your public memory graph is live:",
                    normalizePublicGraphUrl(cfg.webBaseUrl, status.slug),
                  ].join("\n"),
                };
              }

              const published = await client.publishPublicGraph();
              if (published?.slug) {
                return {
                  text: [
                    "Your public memory graph is live:",
                    normalizePublicGraphUrl(cfg.webBaseUrl, published.slug),
                  ].join("\n"),
                };
              }

              throw new Error("Public graph publish did not return a slug");
            } catch (error) {
              const privateGraph = await client.createWebGraphLink().catch(() => null);
              return {
                text: [
                  `Public graph is not ready yet: ${String(error?.message || error)}`,
                  privateGraph?.url ? `Private graph instead: ${privateGraph.url}` : null,
                ].filter(Boolean).join("\n"),
              };
            }
          }

          return {
            text: [
              "Unknown graph mode.",
              `Usage: ${commandLabel} graph`,
              `Usage: ${commandLabel} graph public`,
            ].join("\n"),
          };
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
