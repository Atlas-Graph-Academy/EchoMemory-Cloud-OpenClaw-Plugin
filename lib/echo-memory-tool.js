import { buildToolSearchResult, formatSearchResultsText } from "./echo-memory-search.js";

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
