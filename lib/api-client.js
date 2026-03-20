function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function parseErrorResponse(response) {
  const payload = await response.json().catch(() => ({}));
  const detail = typeof payload?.details === "string" ? payload.details : payload?.error;
  throw new Error(detail || `HTTP ${response.status}`);
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      await parseErrorResponse(response);
    }

    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timeoutId);
  }
}

async function requestStreamJson(url, options, timeoutMs, { onStageEvent } = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    if (!response.ok) {
      await parseErrorResponse(response);
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/x-ndjson") || !response.body) {
      return await response.json().catch(() => ({}));
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let finalPayload = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          const message = JSON.parse(line);
          if (message?.type === "stage") {
            onStageEvent?.(message);
          } else if (message?.type === "result") {
            finalPayload = message.payload ?? null;
          }
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    const tail = buffer.trim();
    if (tail) {
      const message = JSON.parse(tail);
      if (message?.type === "stage") {
        onStageEvent?.(message);
      } else if (message?.type === "result") {
        finalPayload = message.payload ?? null;
      }
    }

    if (!finalPayload) {
      throw new Error("Stream completed without a final result payload");
    }

    if (
      finalPayload?.error
      && (!Array.isArray(finalPayload?.results) || finalPayload.results.length === 0)
    ) {
      throw new Error(finalPayload.error);
    }

    return finalPayload;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createApiClient(cfg) {
  const whoamiUrl = `${cfg.baseUrl}/api/openclaw/v1/whoami`;
  const importUrl = `${cfg.baseUrl}/api/openclaw/v1/import-markdown`;
  const statusUrl = `${cfg.baseUrl}/api/openclaw/v1/import-status`;
  const sourcesUrl = `${cfg.baseUrl}/api/openclaw/v1/sources`;
  const searchUrl = `${cfg.baseUrl}/api/extension/memories/search`;

  async function whoami() {
    if (!cfg.apiKey) {
      throw new Error("Missing Echo API key");
    }
    return requestJson(
      whoamiUrl,
      {
        method: "GET",
        headers: buildHeaders(cfg.apiKey),
      },
      cfg.requestTimeoutMs,
    );
  }

  async function importMarkdown(files, opts = {}) {
    if (!cfg.apiKey) {
      throw new Error("Missing Echo API key");
    }
    return requestStreamJson(
      `${importUrl}?stream=1`,
      {
        method: "POST",
        headers: {
          ...buildHeaders(cfg.apiKey),
          Accept: "application/x-ndjson",
          "X-OpenClaw-Stream": "1",
        },
        body: JSON.stringify({ files }),
      },
      cfg.requestTimeoutMs,
      opts,
    );
  }

  async function getImportStatus() {
    if (!cfg.apiKey) {
      throw new Error("Missing Echo API key");
    }
    return requestJson(
      statusUrl,
      {
        method: "GET",
        headers: buildHeaders(cfg.apiKey),
      },
      cfg.requestTimeoutMs,
    );
  }

  async function searchMemories({ query, k, similarityThreshold, timeFrameDays } = {}) {
    if (!cfg.apiKey) {
      throw new Error("Missing Echo API key");
    }
    return requestJson(
      searchUrl,
      {
        method: "POST",
        headers: buildHeaders(cfg.apiKey),
        body: JSON.stringify({
          query,
          k,
          similarityThreshold,
          timeFrameDays,
        }),
      },
      cfg.requestTimeoutMs,
    );
  }

  async function listAllSources() {
    if (!cfg.apiKey) throw new Error("Missing Echo API key");
    return requestJson(
      sourcesUrl,
      { method: "GET", headers: buildHeaders(cfg.apiKey) },
      cfg.requestTimeoutMs,
    );
  }

  return {
    whoami,
    importMarkdown,
    getImportStatus,
    listAllSources,
    searchMemories,
  };
}
