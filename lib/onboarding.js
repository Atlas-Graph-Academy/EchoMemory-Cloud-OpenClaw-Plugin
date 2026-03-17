function normalizeTopic(rawTopic) {
  const topic = String(rawTopic || "").trim().toLowerCase();
  if (!topic || ["all", "overview", "onboard", "onboarding", "start", "help"].includes(topic)) {
    return "overview";
  }
  if (/(sign|account|login|api|key|developer)/.test(topic)) return "signup";
  if (/(install|config|setup|env|memorydir)/.test(topic)) return "setup";
  if (/(command|usage|slash|tool)/.test(topic)) return "commands";
  if (/(graph|public|private|security)/.test(topic)) return "graph";
  if (/(search|sync|status|retriev)/.test(topic)) return "operations";
  if (/(trouble|error|debug|issue|auth|authorize)/.test(topic)) return "troubleshooting";
  return "overview";
}

function buildSectionMap(commandLabel, cfg) {
  return {
    signup: {
      title: "Signup and API key",
      lines: [
        "1. Sign up for an EchoMemory account at `http://iditor.com/signup/openclaw`.",
        "2. Check your email for the 6-digit OTP and enter it to complete login.",
        "3. If this is your first login, enter referral code `openclawyay` and choose a user name to complete registration.",
        "4. Then open `https://www.iditor.com/api`, click the `API Keys` button in the upper-left area, and create a key with a name.",
        "5. Put that `ec_...` key into the plugin config as `apiKey`.",
        "6. Recommended scopes: `ingest:write` for sync and `memory:read` for retrieval.",
      ],
    },
    setup: {
      title: "Install and config",
      lines: [
        `- Fixed backend endpoint: \`${cfg.baseUrl}\`.`,
        `- Fixed web app endpoint for graph links: \`${cfg.webBaseUrl}\`.`,
        "- Required config: `apiKey`.",
        "- Optional config: `memoryDir`, `autoSync`, `syncIntervalMinutes`, `batchSize`, `requestTimeoutMs`.",
        "- `memoryDir` resolution order: plugin config, `ECHOMEM_MEMORY_DIR`, then `~/.openclaw/workspace/memory`.",
        "- Supported `.env` locations: `~/.openclaw/.env`, `~/.moltbot/.env`, `~/.clawdbot/.env`.",
        "- Restart `openclaw gateway` after install or config changes.",
      ],
    },
    commands: {
      title: "Commands and usage",
      lines: [
        `- \`${commandLabel} onboard\` for the full setup guide, or \`${commandLabel} onboard <topic>\` for focused help.`,
        `- \`${commandLabel} view\` opens the local localhost workspace UI that reads your markdown files directly.`,
        `- \`${commandLabel} whoami\` verifies the current API key and scopes.`,
        `- \`${commandLabel} status\` checks local sync state and remote import status.`,
        `- \`${commandLabel} sync\` pushes markdown memories into EchoMem Cloud.`,
        `- \`${commandLabel} search <query>\` runs semantic memory retrieval.`,
        `- \`${commandLabel} graph\` opens the private cloud memory graph login page and \`${commandLabel} graph public\` opens the public memories page.`,
        `- \`${commandLabel} help\` returns the short command list.`,
      ],
    },
    graph: {
      title: "Graph links and security",
      lines: [
        `- Private graph access intentionally goes to \`${cfg.webBaseUrl}/login?next=/memory-graph\` so the user logs in again.`,
        "- The plugin no longer returns an auto-login bridge link for the personal graph.",
        `- Public graph access still goes to \`${cfg.webBaseUrl}/memories\`.`,
        "- This separation is intentional because the personal graph now includes entry points such as the developer API key dashboard.",
      ],
    },
    operations: {
      title: "How retrieval works",
      lines: [
        "- Manual retrieval: use the search command when you want deterministic memory lookup.",
        "- Natural retrieval: the plugin registers tools so OpenClaw can search EchoMem during normal chat when memory context is relevant.",
        "- Semantic search works better with topics or meaning than with overly literal phrase matching.",
        "- Good smoke test order: whoami, status, sync, then search for a known memory topic.",
      ],
    },
    troubleshooting: {
      title: "Troubleshooting",
      lines: [
        "- `This command requires authorization`: fix Slack/OpenClaw allowlists, then restart the gateway.",
        "- `plugin not found`: reinstall or relink the plugin, then restart the gateway.",
        "- Zero search results: confirm sync/import happened and the API key has `memory:read`.",
        "- Repo edits not taking effect: linked installs are safer than copied installs during active development.",
        "- If graph access fails, remember the private graph now requires a fresh browser login rather than a handoff link.",
      ],
    },
  };
}

export function buildOnboardingText({ topic, commandLabel, cfg }) {
  const resolvedTopic = normalizeTopic(topic);
  const sections = buildSectionMap(commandLabel, cfg);
  const order = resolvedTopic === "overview"
    ? ["signup", "setup", "commands", "graph", "operations", "troubleshooting"]
    : [resolvedTopic];

  const blocks = [
    "Echo Memory plugin onboarding",
    "",
  ];

  for (const key of order) {
    const section = sections[key];
    if (!section) continue;
    blocks.push(`${section.title}:`);
    blocks.push(...section.lines);
    blocks.push("");
  }

  blocks.push("Focused topics:");
  blocks.push(
    `${commandLabel} onboard signup`,
    `${commandLabel} onboard setup`,
    `${commandLabel} onboard commands`,
    `${commandLabel} onboard graph`,
    `${commandLabel} onboard operations`,
    `${commandLabel} onboard troubleshooting`,
  );

  return {
    topic: resolvedTopic,
    text: blocks.join("\n").trim(),
    sections: order,
  };
}
