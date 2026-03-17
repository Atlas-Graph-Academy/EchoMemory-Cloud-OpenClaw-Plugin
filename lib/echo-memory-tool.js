import { buildToolSearchResult, formatSearchResultsText } from "./echo-memory-search.js";
import { buildOnboardingText } from "./onboarding.js";
import { formatStatusText } from "./sync.js";
import { readLastSyncState } from "./state.js";

function readStringParam(params, key, { required = false } = {}) {
  const raw = params?.[key];
  if (typeof raw !== "string") {
    if (required) {
      throw new Error(`${key} required`);
    }
    return undefined;
  }
  const value = raw.trim();
  if (!value) {
    if (required) {
      throw new Error(`${key} required`);
    }
    return undefined;
  }
  return value;
}

function readNumberParam(params, key) {
  const raw = params?.[key];
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw.trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function readBooleanParam(params, key) {
  const raw = params?.[key];
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  }
  return undefined;
}

function buildToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      query: { type: "string", description: "Natural-language memory search query." },
      maxResults: {
        type: "number",
        description: "Maximum number of results to return. Defaults to 5.",
      },
      similarityThreshold: {
        type: "number",
        description: "Semantic match threshold from 0 to 1. Defaults to 0.35.",
      },
      timeFrameDays: {
        type: "number",
        description: "Optional time window in days for fresher results.",
      },
    },
    required: ["query"],
  };
}

function buildGraphToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      visibility: {
        type: "string",
        description: "Which graph page to open: `private` for the user's personal graph, or `public` for the shared public memories page.",
      },
    },
  };
}

function buildStatusToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

function buildLocalUiToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      openInBrowser: {
        type: "boolean",
        description: "Whether to also open the local UI URL in the host machine's default browser.",
      },
    },
  };
}

function buildSyncToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: {
        type: "string",
        description: "Optional sync trigger label. Use `manual` unless a different label is explicitly needed.",
      },
    },
  };
}

function buildOnboardToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
  };
}

export function buildPrivateGraphLoginUrl(cfg) {
  return `${cfg.webBaseUrl}/login?next=/memory-graph`;
}

export function createEchoMemoryLocalUiTool({ getLocalUiUrl, commandLabel = "/echo-memory" }) {
  return {
    label: "Echo Memory Local UI",
    name: "echo_memory_local_ui",
    ownerOnly: true,
    description:
      "Get the live localhost URL for the Echo Memory local workspace UI that directly reads local markdown files, and optionally open it in the host machine's default browser. This corresponds to `/echo-memory view`, not the cloud memory graph.",
    parameters: buildLocalUiToolParametersSchema(),
    execute: async (_toolCallId, params) => {
      try {
        const requestedOpen = readBooleanParam(params, "openInBrowser") === true;
        const result = await getLocalUiUrl({ openInBrowser: requestedOpen, trigger: "tool" });
        return {
          content: [
            {
              type: "text",
              text: [
                "Open the local workspace UI:",
                result.url,
                result.openedInBrowser ? "The default browser was opened on the host machine." : `You can also run \`${commandLabel} view\`.`,
              ].join("\n"),
            },
          ],
          details: {
            url: result.url,
            openedInBrowser: result.openedInBrowser,
            openReason: result.openReason,
          },
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [
            {
              type: "text",
              text: [
                "Echo memory local UI unavailable.",
                message,
                `Fallback: run \`${commandLabel} view\` after fixing the local-ui install/build issue.`,
              ].join("\n"),
            },
          ],
          details: {
            url: null,
            unavailable: true,
            error: message,
          },
        };
      }
    },
  };
}

export function createEchoMemoryOnboardTool(cfg, commandLabel = "/echo-memory") {
  return {
    label: "Echo Memory Onboarding",
    name: "echo_memory_onboard",
    ownerOnly: true,
    description:
      "Authoritative OpenClaw-specific onboarding for Echo Memory: signup URL, OTP and referral flow, API key creation, plugin config, commands, graph links, local UI, and troubleshooting. Use this instead of generic setup advice.",
    parameters: buildOnboardToolParametersSchema(),
    execute: async (_toolCallId, _params) => {
      const guide = buildOnboardingText({
        commandLabel,
        cfg,
      });
      return {
        content: [
          {
            type: "text",
            text: guide.text,
          },
        ],
        details: {
          guide: "full",
        },
      };
    },
  };
}

export function createEchoMemorySearchTool(client) {
  return {
    label: "Echo Memory Search",
    name: "echo_memory_search",
    ownerOnly: true,
    description:
      "Search the user's EchoMem cloud memories imported from OpenClaw markdown and return the most relevant prior facts, plans, preferences, dates, and narrative details.",
    parameters: buildToolParametersSchema(),
    execute: async (_toolCallId, params) => {
      try {
        const query = readStringParam(params, "query", { required: true });
        const maxResults = readNumberParam(params, "maxResults");
        const similarityThreshold = readNumberParam(params, "similarityThreshold");
        const timeFrameDays = readNumberParam(params, "timeFrameDays");
        const payload = await client.searchMemories({
          query,
          k: maxResults,
          similarityThreshold: similarityThreshold ?? 0.3,
          timeFrameDays,
        });

        return {
          content: [
            {
              type: "text",
              text: formatSearchResultsText(query, payload),
            },
          ],
          details: buildToolSearchResult(query, payload),
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [
            {
              type: "text",
              text: [
                "Echo memory search unavailable.",
                message,
                "Ensure the API key includes memory read access, such as `memory:read` or `mcp:tools`.",
              ].join("\n"),
            },
          ],
          details: {
            query: params?.query ?? null,
            count: 0,
            unavailable: true,
            error: message,
          },
        };
      }
    },
  };
}

export function createEchoMemoryGraphTool(client, cfg) {
  return {
    label: "Echo Memory Graph Link",
    name: "echo_memory_graph_link",
    ownerOnly: true,
    description:
      "Create an iditor.com link for the user to visually open Echo memory graphs. Use `private` for the user's personal cloud graph and `public` for the shared public memories page. Do not use this for the local localhost markdown viewer.",
    parameters: buildGraphToolParametersSchema(),
    execute: async (_toolCallId, params) => {
      try {
        const requestedVisibility = readStringParam(params, "visibility") || "private";
        const visibility = requestedVisibility.toLowerCase() === "public" ? "public" : "private";

        if (visibility === "public") {
          const url = `${cfg.webBaseUrl}/memories`;
          return {
            content: [
              {
                type: "text",
                text: [
                  "Open the public memory page:",
                  url,
                ].join("\n"),
              },
            ],
            details: {
              visibility,
              url,
              expiresAt: null,
            },
          };
        }

        const url = buildPrivateGraphLoginUrl(cfg);
        return {
          content: [
            {
              type: "text",
              text: [
                "Log in again to open your private memory graph:",
                url,
                "This intentionally requires a fresh web login for security.",
              ].filter(Boolean).join("\n"),
            },
          ],
          details: {
            visibility,
            url,
            expiresAt: null,
          },
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [
            {
              type: "text",
              text: [
                "Echo memory graph link unavailable.",
                message,
                "Ensure the API key includes memory read access, such as `memory:read` or `mcp:tools`.",
              ].join("\n"),
            },
          ],
          details: {
            visibility: params?.visibility ?? "private",
            url: null,
            unavailable: true,
            error: message,
          },
        };
      }
    },
  };
}

export function createEchoMemoryStatusTool(client, syncRunner) {
  return {
    label: "Echo Memory Status",
    name: "echo_memory_status",
    ownerOnly: true,
    description:
      "Check the user's Echo memory sync status, including the latest local sync summary and current Echo backend import status.",
    parameters: buildStatusToolParametersSchema(),
    execute: async () => {
      try {
        const [localState, remoteStatus] = await Promise.all([
          readLastSyncState(syncRunner.getStatePath()),
          client.getImportStatus().catch(() => null),
        ]);

        return {
          content: [
            {
              type: "text",
              text: formatStatusText(localState, remoteStatus),
            },
          ],
          details: {
            localState,
            remoteStatus,
          },
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [
            {
              type: "text",
              text: [
                "Echo memory status unavailable.",
                message,
              ].join("\n"),
            },
          ],
          details: {
            unavailable: true,
            error: message,
          },
        };
      }
    },
  };
}

export function createEchoMemorySyncTool(client, syncRunner) {
  return {
    label: "Echo Memory Sync",
    name: "echo_memory_sync",
    ownerOnly: true,
    description:
      "Run a markdown-to-cloud sync from the local OpenClaw memory folder into EchoMem and return the resulting sync summary.",
    parameters: buildSyncToolParametersSchema(),
    execute: async (_toolCallId, params) => {
      try {
        const trigger = readStringParam(params, "mode") || "manual";
        const localState = await syncRunner.runSync(trigger);
        const remoteStatus = await client.getImportStatus().catch(() => null);
        return {
          content: [
            {
              type: "text",
              text: formatStatusText(localState, remoteStatus),
            },
          ],
          details: {
            trigger,
            localState,
            remoteStatus,
          },
        };
      } catch (error) {
        const message = String(error?.message ?? error);
        return {
          content: [
            {
              type: "text",
              text: [
                "Echo memory sync unavailable.",
                message,
              ].join("\n"),
            },
          ],
          details: {
            trigger: params?.mode ?? "manual",
            unavailable: true,
            error: message,
          },
        };
      }
    },
  };
}
