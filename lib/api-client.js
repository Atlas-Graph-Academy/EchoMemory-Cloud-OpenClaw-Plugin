function buildHeaders(apiKey) {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
}

async function requestJson(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = typeof payload?.details === "string" ? payload.details : payload?.error;
      throw new Error(detail || `HTTP ${response.status}`);
    }

    return payload;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function createApiClient(cfg) {
  const whoamiUrl = `${cfg.baseUrl}/api/openclaw/v1/whoami`;
  const importUrl = `${cfg.baseUrl}/api/openclaw/v1/import-markdown`;
  const statusUrl = `${cfg.baseUrl}/api/openclaw/v1/import-status`;
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

  async function importMarkdown(files) {
    if (!cfg.apiKey) {
      throw new Error("Missing Echo API key");
    }
    return requestJson(
      importUrl,
      {
        method: "POST",
        headers: buildHeaders(cfg.apiKey),
        body: JSON.stringify({ files }),
      },
      cfg.requestTimeoutMs,
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

  return {
    whoami,
    importMarkdown,
    getImportStatus,
    searchMemories,
  };
}
