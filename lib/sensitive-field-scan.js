const TOKEN_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bpk-[A-Za-z0-9_-]{12,}\b/g,
  /\blin_api_[A-Za-z0-9_-]{12,}\b/g,
  /\bec_[A-Za-z0-9_-]{12,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bxoxb-[A-Za-z0-9-]{16,}\b/g,
];

function isLikelyPlaceholder(value) {
  const normalized = String(value).toLowerCase();
  return /(your|example|sample|placeholder|changeme|dummy|fake|mock|test|todo|xxx|here|null|undefined)/.test(normalized);
}

const DETECTION_RULES = [
  {
    id: "tokens",
    singular: "token",
    plural: "tokens",
    panelLabel: "API keys / tokens",
    highRisk: true,
    patterns: TOKEN_PATTERNS,
    shouldCount: (match) => !isLikelyPlaceholder(match),
  },
  {
    id: "passwords",
    singular: "password",
    plural: "passwords",
    panelLabel: "Password fields",
    highRisk: true,
    patterns: [
      /(?:^|\n)\s*(?:password|secret|token)\s*:\s*(?!["']?(?:your_|example|sample|test|placeholder|changeme|null|undefined|xxx|todo)\b)["']?[^\s"']{4,}[^\n]*/gi,
    ],
    shouldCount: (match) => {
      const [, value = ""] = String(match).split(/:\s*/, 2);
      return value && !isLikelyPlaceholder(value);
    },
  },
  {
    id: "envVars",
    singular: "env var",
    plural: "env vars",
    panelLabel: "Environment variables",
    highRisk: true,
    patterns: [
      /(?:^|\n)\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD)[A-Z0-9_]*\s*=\s*(?!["']?(?:your_|example|sample|test|placeholder|changeme|null|undefined|xxx|todo)\b)["']?[^\s"']{4,}[^\n]*/gm,
    ],
    shouldCount: (match) => {
      const [, value = ""] = String(match).split(/=\s*/, 2);
      return value && !isLikelyPlaceholder(value);
    },
  },
  {
    id: "emails",
    singular: "email",
    plural: "emails",
    panelLabel: "Email addresses",
    highRisk: false,
    patterns: [
      /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    ],
    shouldCount: (match) => {
      const normalized = String(match).toLowerCase();
      return !normalized.endsWith("@example.com") && normalized !== "xxx@xxx.xxx";
    },
  },
  {
    id: "longStrings",
    singular: "long string",
    plural: "long strings",
    panelLabel: "Long random strings",
    highRisk: false,
    patterns: [
      /\b(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2}|[A-Za-z0-9_-]{40,})\b/g,
    ],
    shouldCount: (match) => {
      const value = String(match);
      if (isLikelyPlaceholder(value)) return false;
      if (/^[A-Fa-f0-9]{32,}$/.test(value)) return true;
      if (/[+/=]/.test(value)) return /[A-Za-z]/.test(value) && /\d/.test(value);
      return /[A-Za-z]/.test(value) && /\d/.test(value);
    },
  },
];

function collectMatches(content, rule) {
  let count = 0;
  for (const pattern of rule.patterns) {
    const matches = content.match(pattern);
    if (!Array.isArray(matches)) continue;
    for (const match of matches) {
      if (rule.shouldCount && !rule.shouldCount(match)) continue;
      count += 1;
    }
  }
  return count;
}

function formatSummaryPart(finding) {
  return `${finding.count} ${finding.count === 1 ? finding.singular : finding.plural}`;
}

function buildSummary(findings) {
  if (!findings.length) return null;
  const sorted = [...findings].sort((left, right) => {
    if (left.highRisk !== right.highRisk) return left.highRisk ? -1 : 1;
    if (left.count !== right.count) return right.count - left.count;
    return left.id.localeCompare(right.id);
  });
  const visible = sorted.slice(0, 2).map(formatSummaryPart);
  if (sorted.length > 2) {
    visible.push(`+${sorted.length - 2} types`);
  }
  return visible.join(" | ");
}

export function scanSensitiveFields(content) {
  const safeContent = typeof content === "string" ? content : "";
  const findings = [];

  for (const rule of DETECTION_RULES) {
    const count = collectMatches(safeContent, rule);
    if (count <= 0) continue;
    findings.push({
      id: rule.id,
      singular: rule.singular,
      plural: rule.plural,
      label: rule.panelLabel,
      count,
      highRisk: rule.highRisk,
    });
  }

  const totalCount = findings.reduce((sum, finding) => sum + finding.count, 0);
  const highRisk = findings.some((finding) => finding.highRisk);

  return {
    hasSensitive: findings.length > 0,
    highRisk,
    totalCount,
    summary: buildSummary(findings),
    findings,
  };
}
