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

function isBareIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "").trim());
}

const MONTH_INDEX_BY_NAME = new Map([
  ["january", 0],
  ["jan", 0],
  ["february", 1],
  ["feb", 1],
  ["march", 2],
  ["mar", 2],
  ["april", 3],
  ["apr", 3],
  ["may", 4],
  ["june", 5],
  ["jun", 5],
  ["july", 6],
  ["jul", 6],
  ["august", 7],
  ["aug", 7],
  ["september", 8],
  ["sep", 8],
  ["sept", 8],
  ["october", 9],
  ["oct", 9],
  ["november", 10],
  ["nov", 10],
  ["december", 11],
  ["dec", 11],
]);

function normalizeDateBoundary(value, { endOfDay = false } = {}) {
  const text = String(value || "").trim();
  if (!text) return text;
  if (!isBareIsoDate(text)) return text;
  return `${text}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`;
}

function formatUtcDate(year, monthIndex, day) {
  return `${String(year).padStart(4, "0")}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getMonthDateRange(year, monthIndex) {
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  return {
    startDate: normalizeDateBoundary(formatUtcDate(year, monthIndex, 1), { endOfDay: false }),
    endDate: normalizeDateBoundary(formatUtcDate(year, monthIndex, lastDay), { endOfDay: true }),
  };
}

function getYearDateRange(year) {
  return {
    startDate: normalizeDateBoundary(`${String(year).padStart(4, "0")}-01-01`, { endOfDay: false }),
    endDate: normalizeDateBoundary(`${String(year).padStart(4, "0")}-12-31`, { endOfDay: true }),
  };
}

function resolveDateRange({ startDate, endDate, timeFrameDays }) {
  const hasStartDate = typeof startDate === "string" && startDate.trim().length > 0;
  const hasEndDate = typeof endDate === "string" && endDate.trim().length > 0;

  if (hasStartDate !== hasEndDate) {
    throw new Error("startDate and endDate must be provided together");
  }

  if (hasStartDate && hasEndDate) {
    return {
      startDate: normalizeDateBoundary(startDate, { endOfDay: false }),
      endDate: normalizeDateBoundary(endDate, { endOfDay: true }),
      rangeMode: "explicit",
    };
  }

  if (typeof timeFrameDays === "number" && Number.isFinite(timeFrameDays) && timeFrameDays > 0) {
    const end = new Date();
    const start = new Date(end.getTime() - (timeFrameDays * 24 * 60 * 60 * 1000));
    return {
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      rangeMode: "rolling",
    };
  }

  return null;
}

function extractDateRangeFromQuery(query) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return null;

  const dateMatches = Array.from(rawQuery.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g));
  if (dateMatches.length < 2) return null;

  const startDate = dateMatches[0]?.[0];
  const endDate = dateMatches[1]?.[0];
  if (!startDate || !endDate) return null;

  let residualQuery = rawQuery
    .replace(startDate, " ")
    .replace(endDate, " ")
    .replace(/\b(from|between|to|and|through|thru|until|til|within|during|for|in)\b/gi, " ")
    .replace(/[,:;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // A query that is only date glue should be treated as date-only retrieval.
  if (/^(to|and|-)?$/i.test(residualQuery)) {
    residualQuery = "";
  }

  return {
    startDate: normalizeDateBoundary(startDate, { endOfDay: false }),
    endDate: normalizeDateBoundary(endDate, { endOfDay: true }),
    residualQuery,
  };
}

function stripDatePhraseFromQuery(query, phrasePattern) {
  return String(query || "")
    .replace(phrasePattern, " ")
    .replace(/\b(from|between|to|and|through|thru|until|til|within|during|for|in|on)\b/gi, " ")
    .replace(/[,:;()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNaturalLanguageDateRangeFromQuery(query, now = new Date()) {
  const rawQuery = String(query || "").trim();
  if (!rawQuery) return null;
  const normalized = rawQuery.toLowerCase();

  if (/\blast year\b/i.test(normalized)) {
    const year = now.getUTCFullYear() - 1;
    return {
      ...getYearDateRange(year),
      residualQuery: stripDatePhraseFromQuery(rawQuery, /\blast year\b/gi),
    };
  }

  if (/\bthis year\b/i.test(normalized)) {
    const year = now.getUTCFullYear();
    return {
      ...getYearDateRange(year),
      residualQuery: stripDatePhraseFromQuery(rawQuery, /\bthis year\b/gi),
    };
  }

  if (/\blast month\b/i.test(normalized)) {
    const currentYear = now.getUTCFullYear();
    const previousMonthIndex = now.getUTCMonth() - 1;
    const year = previousMonthIndex < 0 ? currentYear - 1 : currentYear;
    const monthIndex = previousMonthIndex < 0 ? 11 : previousMonthIndex;
    return {
      ...getMonthDateRange(year, monthIndex),
      residualQuery: stripDatePhraseFromQuery(rawQuery, /\blast month\b/gi),
    };
  }

  if (/\bthis month\b/i.test(normalized)) {
    return {
      ...getMonthDateRange(now.getUTCFullYear(), now.getUTCMonth()),
      residualQuery: stripDatePhraseFromQuery(rawQuery, /\bthis month\b/gi),
    };
  }

  const monthNamePattern = Array.from(MONTH_INDEX_BY_NAME.keys())
    .sort((left, right) => right.length - left.length)
    .join("|");
  const monthYearPattern = new RegExp(`\\b(${monthNamePattern})\\s+(20\\d{2})\\b`, "i");
  const yearMonthPattern = new RegExp(`\\b(20\\d{2})\\s+(${monthNamePattern})\\b`, "i");
  const monthYearMatch = rawQuery.match(monthYearPattern);
  const yearMonthMatch = rawQuery.match(yearMonthPattern);
  const matchedText = monthYearMatch?.[0] || yearMonthMatch?.[0] || null;
  const monthToken = monthYearMatch?.[1] || yearMonthMatch?.[2] || null;
  const yearToken = monthYearMatch?.[2] || yearMonthMatch?.[1] || null;

  if (matchedText && monthToken && yearToken) {
    const monthIndex = MONTH_INDEX_BY_NAME.get(String(monthToken).toLowerCase());
    const year = Number(yearToken);
    if (monthIndex !== undefined && Number.isFinite(year)) {
      return {
        ...getMonthDateRange(year, monthIndex),
        residualQuery: stripDatePhraseFromQuery(rawQuery, matchedText),
      };
    }
  }

  return null;
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase();
}

function parseMemoryTimestamp(value) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function scoreMemoryKeywordMatch(query, memory) {
  const queryText = normalizeSearchText(query);
  if (!queryText) return 0;

  const tokens = Array.from(new Set(
    queryText
      .split(/[^a-z0-9]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  ));

  const fields = {
    description: normalizeSearchText(memory?.description),
    details: normalizeSearchText(memory?.details),
    keys: normalizeSearchText(memory?.keys),
    category: normalizeSearchText(memory?.category),
    object: normalizeSearchText(memory?.object),
    location: normalizeSearchText(memory?.location),
    emotion: normalizeSearchText(memory?.emotion),
  };

  const joined = Object.values(fields).filter(Boolean).join("\n");
  if (!joined) return 0;

  let score = 0;
  if (joined.includes(queryText)) {
    score += 12;
  }

  for (const token of tokens) {
    if (fields.description.includes(token)) score += 4;
    if (fields.keys.includes(token)) score += 4;
    if (fields.details.includes(token)) score += 2;
    if (fields.category.includes(token)) score += 2;
    if (fields.object.includes(token)) score += 2;
    if (fields.location.includes(token)) score += 2;
    if (fields.emotion.includes(token)) score += 1;
  }

  return score;
}

function buildTimeRangePayload(payload, retrievalMode) {
  return {
    ...payload,
    retrievalMode,
  };
}

function buildHybridSearchPayload(query, payload, limit) {
  const memories = Array.isArray(payload?.memories) ? payload.memories : [];
  const scored = memories
    .map((memory) => ({
      ...memory,
      match_score: scoreMemoryKeywordMatch(query, memory),
    }))
    .filter((memory) => memory.match_score > 0)
    .sort((left, right) => {
      if (right.match_score !== left.match_score) {
        return right.match_score - left.match_score;
      }
      return parseMemoryTimestamp(right.time) - parseMemoryTimestamp(left.time);
    });

  const rankedMemories = scored.slice(0, limit);
  return {
    success: true,
    memories: rankedMemories,
    count: rankedMemories.length,
    processingTimeMs: Number.isFinite(payload?.processingTimeMs) ? payload.processingTimeMs : null,
    retrievalMode: "time_range_keyword",
    fallbackApplied: false,
  };
}

function buildToolParametersSchema() {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      query: {
        type: "string",
        description: "Optional search query. Omit it for date-only retrieval when a time window is provided.",
      },
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
        description: "Optional rolling time window in days. Can be used alone for date-only retrieval.",
      },
      startDate: {
        type: "string",
        description: "Optional ISO start date/time for explicit time-range retrieval. Must be paired with endDate.",
      },
      endDate: {
        type: "string",
        description: "Optional ISO end date/time for explicit time-range retrieval. Must be paired with startDate.",
      },
    },
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
      "Search the user's EchoMem cloud memories imported from OpenClaw markdown. Supports semantic search, date-only retrieval, and combined query plus explicit date-range filtering.",
    parameters: buildToolParametersSchema(),
    execute: async (_toolCallId, params) => {
      try {
        const rawQuery = readStringParam(params, "query");
        const maxResults = readNumberParam(params, "maxResults");
        const similarityThreshold = readNumberParam(params, "similarityThreshold");
        const timeFrameDays = readNumberParam(params, "timeFrameDays");
        let startDate = readStringParam(params, "startDate");
        let endDate = readStringParam(params, "endDate");
        const limit = Number.isFinite(maxResults) ? maxResults : 5;
        const inferredDateRange = (!startDate && !endDate && rawQuery)
          ? (extractDateRangeFromQuery(rawQuery) || extractNaturalLanguageDateRangeFromQuery(rawQuery))
          : null;
        if (inferredDateRange) {
          startDate = inferredDateRange.startDate;
          endDate = inferredDateRange.endDate;
        }
        const query = inferredDateRange
          ? (inferredDateRange.residualQuery || undefined)
          : rawQuery;
        const dateRange = resolveDateRange({ startDate, endDate, timeFrameDays });

        if (!query && !dateRange) {
          throw new Error("Provide query, or provide startDate/endDate, or provide timeFrameDays");
        }

        let payload;
        let displayQuery = query || "time range";

        if (!query && dateRange) {
          payload = buildTimeRangePayload(
            await client.getMemoriesByTimeRange({
              startDate: dateRange.startDate,
              endDate: dateRange.endDate,
              limit,
            }),
            inferredDateRange
              ? "time_range_inferred"
              : dateRange.rangeMode === "explicit"
                ? "time_range"
                : "time_frame",
          );
        } else if (query && dateRange?.rangeMode === "explicit") {
          const rangePayload = await client.getMemoriesByTimeRange({
            startDate: dateRange.startDate,
            endDate: dateRange.endDate,
            limit: Math.max(limit * 5, 50),
          });
          payload = buildHybridSearchPayload(query, rangePayload, limit);
          displayQuery = `${query} within ${dateRange.startDate} .. ${dateRange.endDate}`;
        } else {
          payload = {
            ...(await client.searchMemories({
              query,
              k: limit,
              similarityThreshold: similarityThreshold ?? 0.3,
              timeFrameDays,
            })),
            retrievalMode: timeFrameDays ? "semantic_search_timeframe" : "semantic_search",
          };
        }

        return {
          content: [
            {
              type: "text",
              text: formatSearchResultsText(displayQuery, payload),
            },
          ],
          details: buildToolSearchResult(displayQuery, payload),
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
