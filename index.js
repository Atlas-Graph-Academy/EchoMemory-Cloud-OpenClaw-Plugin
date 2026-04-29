#!/usr/bin/env node
import path from "node:path";
import { buildConfig, getEnvFileStatus, getOpenClawHome } from "./lib/config.js";
import { createApiClient } from "./lib/api-client.js";
import { formatSearchResultsText } from "./lib/echo-memory-search.js";
import {
  buildPrivateGraphLoginUrl,
  createEchoMemoryGraphTool,
  createEchoMemoryLocalUiTool,
  createEchoMemoryOnboardTool,
  createEchoMemorySearchTool,
  createEchoMemoryStatusTool,
  createEchoMemorySyncTool,
} from "./lib/echo-memory-tool.js";
import { buildOnboardingText } from "./lib/onboarding.js";
import { createSyncRunner, formatStatusText } from "./lib/sync.js";
import { readLastSyncState } from "./lib/state.js";
import {
  hasRecentLocalUiPresence,
  openUrlInDefaultBrowser,
  startLocalServer,
  stopLocalServer,
  waitForLocalUiClient,
} from "./lib/local-server.js";

const LOCAL_UI_RECONNECT_GRACE_MS = 4000;
const LOCAL_UI_PRESENCE_GRACE_MS = 75000;
const COMPAT_STARTUP_DELAY_MS = 1500;
const PROCESS_STATE_KEY = Symbol.for("echo-memory-cloud-openclaw-plugin.process-state");
const OPENCLAW_MEMORY_TOOL_NAMES = new Set(["memory_search", "memory_get"]);
const ECHO_ONLY_MEMORY_AUTH_TTL_MS = 60000;

function getProcessState() {
  const globalState = globalThis;
  if (!globalState[PROCESS_STATE_KEY]) {
    globalState[PROCESS_STATE_KEY] = {
      backgroundActive: false,
      backgroundOwnerId: null,
      backgroundStartPromise: null,
      browserOpenAttempted: false,
      browserOpenPromise: null,
      compatFallbackScheduled: false,
      serviceStartObserved: false,
      stopBackground: null,
    };
  }
  return globalState[PROCESS_STATE_KEY];
}

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

function formatCommandErrorText(action, error, commandLabel) {
  const message = String(error?.message ?? error);

  switch (action) {
    case "view":
      return [
        "Echo memory local UI unavailable.",
        message,
        `Fallback: run \`${commandLabel} view\` after fixing the local-ui install/build issue.`,
      ].join("\n");
    case "whoami":
      return [
        "Echo identity unavailable.",
        message,
        "Ensure the API key is configured and valid.",
      ].join("\n");
    case "search":
      return [
        "Echo memory search unavailable.",
        message,
        "Ensure the API key includes memory read access, such as `memory:read` or `mcp:tools`.",
      ].join("\n");
    case "sync":
      return [
        "Echo memory sync unavailable.",
        message,
      ].join("\n");
    case "graph":
      return [
        "Echo memory graph link unavailable.",
        message,
      ].join("\n");
    case "status":
      return [
        "Echo memory status unavailable.",
        message,
      ].join("\n");
    default:
      return [
        "Echo memory command unavailable.",
        message,
        `Run \`${commandLabel} help\` for available commands.`,
      ].join("\n");
  }
}

export default {
  id: "echo-memory-cloud-openclaw-plugin",
  name: "Echo Memory Cloud OpenClaw Plugin",
  description: "Sync and retrieve OpenClaw markdown memories through Echo cloud",
  kind: "lifecycle",

  register(api) {
    const processState = getProcessState();
    const registrationId = Symbol("echo-memory-cloud-openclaw-plugin.register");
    const cfg = buildConfig(api.pluginConfig);
    const client = createApiClient(cfg);
    const cloudAccessState = {
      apiKey: null,
      checkedAt: 0,
      connected: false,
      inFlight: null,
    };
    const workspaceDir = path.resolve(path.dirname(cfg.memoryDir), "..");
    const openclawHome = getOpenClawHome();
    const legacyPluginStateDir = path.join(openclawHome, "state", "plugins", "echo-memory-cloud-openclaw-plugin");
    const stableStateDir = path.join(openclawHome, "state", "echo-memory-cloud-openclaw-plugin");
    const syncRunner = createSyncRunner({
      api,
      cfg,
      client,
      workspaceDir,
      fallbackStateDir: legacyPluginStateDir,
      stableStateDir,
    });

    if (!workspaceDir || workspaceDir === "." || workspaceDir === path.sep) {
      api.logger?.warn?.("[echo-memory] workspace resolution looks unusual; compatibility fallback may be limited");
    }

    async function maybeAutoOpenLocalUi(url, { trigger = "manual" } = {}) {
      const existingPageDetected = trigger === "gateway-start"
        ? await hasRecentLocalUiPresence(syncRunner, { maxAgeMs: LOCAL_UI_PRESENCE_GRACE_MS })
        : false;
      const existingClientDetected = existingPageDetected || (
        trigger === "gateway-start"
          ? await waitForLocalUiClient({ timeoutMs: LOCAL_UI_RECONNECT_GRACE_MS })
          : false
      );
      return existingClientDetected
        ? { opened: false, reason: existingPageDetected ? "existing_page_detected" : "existing_client_reconnected" }
        : openUrlInDefaultBrowser(url, {
            logger: api.logger,
            force: trigger !== "gateway-start",
          });
    }

    async function maybeAutoOpenStartupBrowser(url) {
      if (!cfg.localUiAutoOpenOnGatewayStart || processState.browserOpenAttempted) {
        return { attempted: false, opened: false, reason: "disabled_or_already_attempted" };
      }
      if (processState.browserOpenPromise) {
        const result = await processState.browserOpenPromise;
        return { attempted: false, ...result };
      }

      const openPromise = maybeAutoOpenLocalUi(url, { trigger: "gateway-start" })
        .then((result) => {
          processState.browserOpenAttempted = true;
          return result;
        })
        .finally(() => {
          if (processState.browserOpenPromise === openPromise) {
            processState.browserOpenPromise = null;
          }
        });
      processState.browserOpenPromise = openPromise;
      const result = await openPromise;
      return { attempted: true, ...result };
    }

    async function ensureLocalUi({ openInBrowser = false, trigger = "manual" } = {}) {
      const url = await startLocalServer(workspaceDir, {
        apiClient: client,
        syncRunner,
        cfg,
        logger: api.logger,
        pluginConfig: api.pluginConfig,
      });

      let openedInBrowser = false;
      let openReason = "not_requested";
      if (openInBrowser) {
        const openResult = await maybeAutoOpenLocalUi(url, { trigger });
        openedInBrowser = openResult.opened;
        openReason = openResult.reason;
      }

      return { url, openedInBrowser, openReason };
    }

    function isEchoOnlyMemoryToggleEnabled() {
      return cfg.disableOpenClawMemoryToolsWhenConnected === true;
    }

    function hasEchoCloudConfiguration() {
      return isEchoOnlyMemoryToggleEnabled()
        && cfg.localOnlyMode !== true
        && String(cfg.apiKey || "").trim().length > 0;
    }

    function isEchoCloudVerifiedForEchoOnlyMemoryMode() {
      return hasEchoCloudConfiguration()
        && cloudAccessState.connected === true
        && cloudAccessState.checkedAt > 0
        && (Date.now() - cloudAccessState.checkedAt) < ECHO_ONLY_MEMORY_AUTH_TTL_MS;
    }

    async function isEchoCloudReadyForEchoOnlyMemoryMode() {
      if (!hasEchoCloudConfiguration()) {
        cloudAccessState.apiKey = null;
        cloudAccessState.checkedAt = 0;
        cloudAccessState.connected = false;
        return false;
      }

      const apiKey = String(cfg.apiKey || "").trim();
      if (cloudAccessState.apiKey !== apiKey) {
        cloudAccessState.apiKey = apiKey;
        cloudAccessState.checkedAt = 0;
        cloudAccessState.connected = false;
      }

      if (cloudAccessState.inFlight) {
        return cloudAccessState.inFlight;
      }

      if (
        cloudAccessState.checkedAt > 0
        && (Date.now() - cloudAccessState.checkedAt) < ECHO_ONLY_MEMORY_AUTH_TTL_MS
      ) {
        return cloudAccessState.connected;
      }

      const verifyPromise = client.whoami()
        .then(() => {
          cloudAccessState.connected = true;
          cloudAccessState.checkedAt = Date.now();
          return true;
        })
        .catch((error) => {
          cloudAccessState.connected = false;
          cloudAccessState.checkedAt = Date.now();
          api.logger?.warn?.(
            `[echo-memory] Echo-only memory mode verification failed; leaving OpenClaw memory tools enabled (${String(error?.message ?? error)})`,
          );
          return false;
        })
        .finally(() => {
          cloudAccessState.inFlight = null;
        });
      cloudAccessState.inFlight = verifyPromise;
      return verifyPromise;
    }

    if (typeof api.registerTool === "function") {
      api.registerTool(createEchoMemorySearchTool(client));
      api.registerTool(createEchoMemoryOnboardTool(cfg, resolveCommandLabel("slack")));
      api.registerTool(createEchoMemoryGraphTool(client, cfg));
      api.registerTool(createEchoMemoryLocalUiTool({
        getLocalUiUrl: ensureLocalUi,
        commandLabel: resolveCommandLabel("slack"),
      }));
      api.registerTool(createEchoMemoryStatusTool(client, syncRunner));
      api.registerTool(createEchoMemorySyncTool(client, syncRunner));
    }
    if (typeof api.on === "function") {
      api.on("before_prompt_build", (_event, _ctx) => {
        const prependSystemContext = [];
        const appendSystemContext = [
          "EchoMem cloud retrieval is available through the `echo_memory_search` tool.",
          "Echo Memory setup and usage guidance is available through the `echo_memory_onboard` tool.",
          "Echo memory graph links are available through the `echo_memory_graph_link` tool.",
          "Echo memory local workspace UI links are available through the `echo_memory_local_ui` tool.",
          "Echo sync inspection is available through the `echo_memory_status` tool.",
          "Echo markdown-to-cloud sync is available through the `echo_memory_sync` tool.",
          "Use it when the conversation asks about prior facts, plans, decisions, dates, preferences, people, or when memory context would improve accuracy.",
          "Prefer it before answering memory-dependent questions instead of guessing.",
          "Use `echo_memory_onboard` when the user asks how to install, set up, configure, authenticate, or use the plugin, or asks about signup, API keys, commands, graph access, or troubleshooting.",
          "Treat any question about becoming a new EchoMemory user, signing up, creating an account, receiving OTP, referral code, API key creation, or configuring the plugin as an onboarding question for `echo_memory_onboard`.",
          "Do not answer Echo Memory signup, account setup, or plugin setup from generic prior knowledge. Call `echo_memory_onboard` so the OpenClaw-specific signup URL, OTP step, referral code, API key flow, command names, and config details stay exact.",
          "There is only one onboarding path. Do not try to choose between signup/setup onboarding variants; call `echo_memory_onboard` and return the full authoritative guide.",
          "Use `echo_memory_graph_link` when the user explicitly asks for the memory graph, cloud graph, graph view, public memories page, or an iditor.com page.",
          "Use `echo_memory_local_ui` when the user asks to open, view, browse, launch, or get the URL for local memories, markdown files, the workspace viewer, the local UI, or the localhost view.",
          "Treat `/echo-memory view` as the local localhost markdown viewer command.",
          "Do not confuse the localhost local workspace UI with the cloud memory graph. The local UI shows local markdown files directly, while graph links open iditor.com pages.",
          "If the user says 'view my memories' or similar without saying graph/iditor/public, prefer the local workspace UI.",
          "If the user asks to open the local workspace UI, request `openInBrowser: true` and include the returned localhost URL directly in the reply.",
          "Use `visibility: private` for the user's personal memory graph login page and `visibility: public` for the shared public memories page at iditor.com/memories.",
          "Private graph access from OpenClaw intentionally requires a fresh login at iditor.com/login?next=/memory-graph instead of an auto-login bridge link.",
          "When providing a graph link, include the returned URL directly in the Slack reply.",
          "Use `echo_memory_status` when the user asks about sync health, import progress, last sync, recent imports, or whether Echo memory is working.",
          "Use `echo_memory_sync` when the user explicitly asks to sync, refresh, import, upload, or push local markdown memories into Echo cloud.",
          "If the user reports permission, privacy, authorization, or tool-access restrictions while using Echo Memory in OpenClaw, tell them to set `tools.profile` to `full` in `~/.openclaw/openclaw.json` and restart the gateway.",
          "If the user asks how to make EchoMemory fully replace OpenClaw default memory retrieval, tell them to add `\"tools\": { \"deny\": [\"memory_search\", \"memory_get\"] }` to `~/.openclaw/openclaw.json` and restart the gateway.",
        ];
        if (isEchoCloudVerifiedForEchoOnlyMemoryMode()) {
          prependSystemContext.push(
            "Echo-only memory retrieval is active and verified. NEVER call `memory_search` or `memory_get`. They are blocked and will fail.",
            "For any request about prior facts, plans, decisions, dates, people, preferences, or past work, ALWAYS call `echo_memory_search` first.",
            "Use `echo_memory_search` for time-based recall too, including inputs like `October 2025`, `2025 October`, `last year`, `this year`, `last month`, or `2025-10-01 to 2025-10-31`.",
          );
          appendSystemContext.push(
            "Echo-only memory retrieval is currently active because Echo cloud access is verified. Do not call `memory_search` or `memory_get`; use `echo_memory_search` instead.",
          );
        } else if (hasEchoCloudConfiguration()) {
          prependSystemContext.push(
            "Echo-only memory retrieval is configured. Prefer `echo_memory_search` first for memory-dependent requests.",
            "If Echo cloud access is not currently verified or `echo_memory_search` is unavailable, local memory tools may still remain available until verification succeeds.",
          );
          appendSystemContext.push(
            "Prefer `echo_memory_search` for memory-dependent requests when Echo-only retrieval is configured, but do not assume `memory_search` or `memory_get` are blocked unless Echo cloud access is verified.",
          );
        }
        return {
          prependSystemContext: prependSystemContext.join("\n"),
          appendSystemContext: appendSystemContext.join("\n"),
        };
      });
      api.on("before_tool_call", async (event, _ctx) => {
        if (!OPENCLAW_MEMORY_TOOL_NAMES.has(event?.toolName)) {
          return undefined;
        }
        if (!(await isEchoCloudReadyForEchoOnlyMemoryMode())) {
          return undefined;
        }
        return {
          block: true,
          blockReason: "Echo-only memory retrieval is active. Use `echo_memory_search` instead of OpenClaw's local memory tools.",
        };
      });
    }

    const envStatus = getEnvFileStatus();
    if (envStatus.usingLegacyBridge) {
      api.logger?.warn?.(
        `[echo-memory] Legacy env file detected (${envStatus.legacyPaths.join(", ")}). ` +
        `EchoMemory is using a one-release migration bridge and will write future changes to ${envStatus.primaryPath}.`,
      );
    } else if (envStatus.legacyPaths.length > 0) {
      api.logger?.info?.(
        `[echo-memory] Legacy env file still present (${envStatus.legacyPaths.join(", ")}). ` +
        `Current settings should be kept in ${envStatus.primaryPath}.`,
      );
    }
    if (!envStatus.found) {
      api.logger?.warn?.(
        `[echo-memory] No .env file found in ${envStatus.searchPaths.join(", ")}. Using plugin config or process env.`,
      );
    }

    async function startBackgroundFeatures({ stateDir = null, trigger = "service" } = {}) {
      const effectiveTrigger = trigger === "service" ? "gateway-start" : trigger;

      if (processState.backgroundActive) {
        if (effectiveTrigger === "gateway-start") {
          const { attempted, opened, reason } = await maybeAutoOpenStartupBrowser(
            await startLocalServer(workspaceDir, {
              apiClient: client,
              syncRunner,
              cfg,
              logger: api.logger,
              pluginConfig: api.pluginConfig,
            }),
          );
          if (attempted) {
            if (opened) {
              api.logger?.info?.("[echo-memory] Opened local workspace viewer in the default browser");
            } else {
              api.logger?.info?.(`[echo-memory] Skipped browser auto-open (${reason})`);
            }
          }
        }
        return;
      }

      if (processState.backgroundStartPromise) {
        await processState.backgroundStartPromise;
        if (effectiveTrigger === "gateway-start") {
          const { attempted, opened, reason } = await maybeAutoOpenStartupBrowser(
            await startLocalServer(workspaceDir, {
              apiClient: client,
              syncRunner,
              cfg,
              logger: api.logger,
              pluginConfig: api.pluginConfig,
            }),
          );
          if (attempted) {
            if (opened) {
              api.logger?.info?.("[echo-memory] Opened local workspace viewer in the default browser");
            } else {
              api.logger?.info?.(`[echo-memory] Skipped browser auto-open (${reason})`);
            }
          }
        }
        return;
      }

      const startPromise = (async () => {
        processState.backgroundOwnerId = registrationId;
        processState.stopBackground = () => {
          syncRunner.stopInterval();
          stopLocalServer();
        };
        await syncRunner.initialize(stateDir || legacyPluginStateDir);

        let url = null;
        try {
          const localUi = await ensureLocalUi({
            openInBrowser: false,
            trigger: effectiveTrigger,
          });
          url = localUi.url;
          api.logger?.info?.(`[echo-memory] Local workspace viewer: ${url}`);
        } catch (error) {
          api.logger?.warn?.(`[echo-memory] local server failed: ${String(error?.message ?? error)}`);
        }

        processState.backgroundActive = true;

        if (effectiveTrigger === "gateway-start" && url) {
          const { attempted, opened, reason } = await maybeAutoOpenStartupBrowser(url);
          if (attempted) {
            if (opened) {
              api.logger?.info?.("[echo-memory] Opened local workspace viewer in the default browser");
            } else {
              api.logger?.info?.(`[echo-memory] Skipped browser auto-open (${reason})`);
            }
          }
        }

        if (!cfg.autoSync) {
          api.logger?.info?.("[echo-memory] autoSync disabled");
          return;
        }

        await syncRunner.runSync(trigger === "service" ? "startup" : trigger).catch((error) => {
          api.logger?.warn?.(`[echo-memory] startup sync failed: ${String(error?.message ?? error)}`);
        });

        syncRunner.startInterval();
      })()
        .catch((error) => {
          if (processState.backgroundOwnerId === registrationId) {
            processState.backgroundActive = false;
            processState.backgroundOwnerId = null;
            processState.stopBackground = null;
          }
          throw error;
        })
        .finally(() => {
          if (processState.backgroundStartPromise === startPromise) {
            processState.backgroundStartPromise = null;
          }
        });

      processState.backgroundStartPromise = startPromise;
      await startPromise;
    }

    if (typeof api.registerService === "function") {
      api.registerService({
        id: "echo-memory-cloud-openclaw-sync",
        start: async (ctx) => {
          processState.serviceStartObserved = true;
          await startBackgroundFeatures({ stateDir: ctx?.stateDir || null, trigger: "service" });
        },
        stop: async () => {
          processState.stopBackground?.();
          processState.backgroundActive = false;
          processState.backgroundOwnerId = null;
          processState.backgroundStartPromise = null;
          processState.browserOpenAttempted = false;
          processState.browserOpenPromise = null;
          processState.compatFallbackScheduled = false;
          processState.serviceStartObserved = false;
          processState.stopBackground = null;
        },
      });
    }

    // Compatibility fallback for older hosts that discover the plugin but do not
    // reliably auto-start registered background services.
    if (!processState.compatFallbackScheduled) {
      processState.compatFallbackScheduled = true;
      setTimeout(() => {
        processState.compatFallbackScheduled = false;
        if (processState.serviceStartObserved || processState.backgroundActive || processState.backgroundStartPromise) {
          return;
        }
        startBackgroundFeatures({ stateDir: legacyPluginStateDir, trigger: "compat-startup" }).catch((error) => {
          api.logger?.warn?.(`[echo-memory] compatibility startup failed: ${String(error?.message ?? error)}`);
        });
      }, COMPAT_STARTUP_DELAY_MS);
    }

    if (typeof api.registerCommand === "function") {
      api.registerCommand({
        name: "echo-memory",
        description: "Sync and search OpenClaw markdown memories through Echo cloud.",
        acceptsArgs: true,
        handler: async (ctx) => {
          const { action, actionArgs } = parseCommandArgs(ctx.args);
          const commandLabel = resolveCommandLabel(ctx.channel);
          try {
            if (action === "view") {
              const { url, openedInBrowser } = await ensureLocalUi({
                openInBrowser: true,
                trigger: "command",
              });
              return {
                text: [
                  `Open your workspace: ${url}`,
                  openedInBrowser
                    ? "The default browser was opened on this machine."
                    : "Open the URL manually if the browser did not launch automatically.",
                  "",
                  "This local UI reads your markdown files directly on localhost. All files stay local until you choose to sync.",
                  `For EchoMemory account signup or plugin onboarding, run ${commandLabel} onboard.`,
                ].join("\n"),
              };
            }

            if (action === "help") {
              return {
                text: [
                  "Echo Memory commands:",
                  "",
                  `${commandLabel} onboard`,
                  `${commandLabel} view`,
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

            if (action === "onboard") {
              const guide = buildOnboardingText({
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
          } catch (error) {
            return {
              text: formatCommandErrorText(action, error, commandLabel),
            };
          }
        },
      });
    }
  },
};
