#!/usr/bin/env node
import path from "node:path";
import { buildConfig, getEnvFileStatus } from "./lib/config.js";
import { createApiClient } from "./lib/api-client.js";
import { formatSearchResultsText } from "./lib/echo-memory-search.js";
import {
  buildPrivateGraphLoginUrl,
  createEchoMemoryGraphTool,
  createEchoMemoryOnboardTool,
  createEchoMemorySearchTool,
  createEchoMemoryStatusTool,
  createEchoMemorySyncTool,
} from "./lib/echo-memory-tool.js";
import { buildOnboardingText } from "./lib/onboarding.js";
import { createSyncRunner, formatStatusText } from "./lib/sync.js";
import { readLastSyncState } from "./lib/state.js";
import { startLocalServer, stopLocalServer } from "./lib/local-server.js";

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
    api.registerTool(createEchoMemoryOnboardTool(cfg, resolveCommandLabel("slack")));
    api.registerTool(createEchoMemoryGraphTool(client, cfg));
    api.registerTool(createEchoMemoryStatusTool(client, syncRunner));
    api.registerTool(createEchoMemorySyncTool(client, syncRunner));
    api.on("before_prompt_build", (_event, ctx) => {
      if (ctx.messageProvider && ctx.messageProvider !== "slack") {
        return;
      }
      return {
        appendSystemContext: [
          "EchoMem cloud retrieval is available through the `echo_memory_search` tool.",
          "Echo Memory setup and usage guidance is available through the `echo_memory_onboard` tool.",
          "Echo memory graph links are available through the `echo_memory_graph_link` tool.",
          "Echo sync inspection is available through the `echo_memory_status` tool.",
          "Echo markdown-to-cloud sync is available through the `echo_memory_sync` tool.",
          "Use it when the conversation asks about prior facts, plans, decisions, dates, preferences, people, or when memory context would improve accuracy.",
          "Prefer it before answering memory-dependent questions instead of guessing.",
          "Use `echo_memory_onboard` when the user asks how to install, set up, configure, authenticate, or use the plugin, or asks about signup, API keys, commands, graph access, or troubleshooting.",
          "Use `echo_memory_graph_link` when the user asks to open, see, view, or visit their memory graph or the public memory page.",
          "Use `visibility: private` for the user's personal memory graph login page and `visibility: public` for the shared public memories page at iditor.com/memories.",
          "Private graph access from OpenClaw intentionally requires a fresh login at iditor.com/login?next=/memory-graph instead of an auto-login bridge link.",
          "When providing a graph link, include the returned URL directly in the Slack reply.",
          "Use `echo_memory_status` when the user asks about sync health, import progress, last sync, recent imports, or whether Echo memory is working.",
          "Use `echo_memory_sync` when the user explicitly asks to sync, refresh, import, upload, or push local markdown memories into Echo cloud.",
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
        stopLocalServer();
      },
    });

    api.registerCommand({
      name: "echo-memory",
      description: "Sync and search OpenClaw markdown memories through Echo cloud.",
      acceptsArgs: true,
      handler: async (ctx) => {
        const { action, actionArgs } = parseCommandArgs(ctx.args);
        const commandLabel = resolveCommandLabel(ctx.channel);

        if (action === "setup") {
          const workspaceDir = path.dirname(cfg.memoryDir);
          const url = await startLocalServer(workspaceDir, {
            apiClient: client,
            syncRunner,
            cfg,
          });
          return {
            text: `Open your workspace: ${url}\n\nAll files stay local until you choose to sync.`,
          };
        }

        if (action === "help") {
          return {
            text: [
              "Echo Memory commands:",
              "",
              `${commandLabel} setup`,
              `${commandLabel} status`,
              `${commandLabel} search <query>`,
              `${commandLabel} graph`,
              `${commandLabel} graph public`,
              `${commandLabel} onboard`,
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

        if (action === "onboard") {
          const guide = buildOnboardingText({
            topic: actionArgs,
            commandLabel,
            cfg,
          });
          return { text: guide.text };
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
            const url = buildPrivateGraphLoginUrl(cfg);
            return {
              text: [
                "Log in again to open your private memory graph:",
                url,
                "This intentionally requires a fresh web login for security.",
              ].filter(Boolean).join("\n"),
            };
          }

          if (graphMode === "public") {
            return {
              text: [
                "Open the public memory page:",
                `${cfg.webBaseUrl}/memories`,
              ].join("\n"),
            };
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
