// Detects credentials and other "leak-on-upload" secrets in markdown content.
//
// Design philosophy:
// - Only flag content that, if shared, would compromise a real account or key.
// - Optimize for PRECISION over RECALL on every individual rule. A false
//   positive on the SECRET tier teaches users to ignore the warning, which
//   is worse than missing one secret.
// - PII (emails, phone numbers, names) is intentionally NOT detected here —
//   that belongs to the PRIVATE tier, which is driven by path/frontmatter
//   conventions, not text scanning.

const PLACEHOLDER_PATTERN =
  /(your[_-]?|example|sample|placeholder|changeme|change[_-]?me|dummy|fake|mock|test[_-]?key|todo|xxx+|here|null|undefined|redacted|\*{3,})/i;

function isLikelyPlaceholder(value) {
  return PLACEHOLDER_PATTERN.test(String(value));
}

// Vendor-prefixed API keys. Each entry is anchored on a distinctive prefix
// the vendor publishes; we only flag them when the trailing entropy looks
// real (length floor + character class).
const VENDOR_TOKEN_PATTERNS = [
  // Anthropic (sk-ant-api03-...)
  /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g,
  // OpenAI (legacy sk-..., project sk-proj-...)
  /\bsk-proj-[A-Za-z0-9_-]{20,}\b/g,
  /\bsk-[A-Za-z0-9]{32,}\b/g,
  // Stripe live/test secret + restricted + publishable
  /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{20,}\b/g,
  // Linear personal API tokens
  /\blin_api_[A-Za-z0-9]{20,}\b/g,
  // Echo Memory product keys (this app)
  /\bec_[A-Za-z0-9]{40,}\b/g,
  // GitHub personal/OAuth/server/user/refresh tokens
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g,
  // Slack bot/app/user/legacy + xapp app-level
  /\bxox[abprs]-[A-Za-z0-9-]{16,}\b/g,
  /\bxapp-[0-9]+-[A-Za-z0-9-]{16,}\b/g,
  // Generic pk- public keys with long body
  /\bpk-[A-Za-z0-9_-]{32,}\b/g,
];

// AWS access key IDs (long-lived AKIA, temporary ASIA). Highly distinctive.
const AWS_ACCESS_KEY_PATTERN = /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g;

// Google Cloud / Firebase API keys. Fixed format: AIza + 35 chars.
const GOOGLE_API_KEY_PATTERN = /\bAIza[0-9A-Za-z_-]{35}\b/g;

// JWT — three base64url segments separated by dots, with the typical
// header "eyJ..." opening. Required header anchor avoids matching random
// dotted strings.
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;

// PEM-encoded private keys (RSA, EC, OpenSSH, DSA, PGP). Header alone
// is sufficient — content following is irrelevant to the leak severity.
const PEM_PRIVATE_KEY_PATTERN =
  /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----/g;

// SSH-style private keys often appear without the PEM wrapper in old configs.
// The anchor "ssh-" + key type catches OpenSSH public-key fingerprints (which
// are NOT secret on their own), so we restrict to the encrypted variant.
const SSH_ENCRYPTED_PATTERN = /-----BEGIN OPENSSH PRIVATE KEY-----/g;

// password/secret/token: VALUE — line-anchored to avoid matching prose.
const INLINE_CREDENTIAL_PATTERN =
  /(?:^|\n)\s*(?:password|passwd|secret|api[_-]?key|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*(?!["'`]?(?:your[_-]?|example|sample|test[_-]?|placeholder|changeme|null|undefined|xxx|todo|<.+?>)\b)["'`]?[^\s"'`]{6,}/gi;

// FOO_KEY=, FOO_SECRET=, FOO_TOKEN=, FOO_PASSWORD= environment vars with
// real-looking values. Same placeholder filter as INLINE.
const ENV_CREDENTIAL_PATTERN =
  /(?:^|\n)\s*(?:export\s+)?[A-Z][A-Z0-9_]{0,30}(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)[A-Z0-9_]*\s*=\s*(?!["'`]?(?:your[_-]?|example|sample|test[_-]?|placeholder|changeme|null|undefined|xxx|todo|<.+?>)\b)["'`]?[^\s"'`]{6,}/gm;

// BIP39 mnemonic seed phrases.
//
// Detection is structural rather than dictionary-based: a line containing
// EXACTLY 12, 15, 18, 21, or 24 lowercase words (3–8 chars each), separated
// by single spaces, with nothing else on the line, is overwhelmingly likely
// to be a seed phrase. Real prose almost never produces this shape.
//
// TODO(precision): validate each word against the official BIP39 English
// wordlist to drive false-positive rate to ~0. Tracked separately because
// embedding 2048 words is a separate change.
const BIP39_LINE_PATTERN = /^[a-z]{3,8}(?: [a-z]{3,8}){11}(?:(?: [a-z]{3,8}){3}){0,4}$/;

function countBip39Lines(content) {
  let count = 0;
  const lines = content.split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    if (!BIP39_LINE_PATTERN.test(line)) continue;
    const wordCount = line.split(/\s+/).length;
    if (![12, 15, 18, 21, 24].includes(wordCount)) continue;
    count += 1;
  }
  return count;
}

const DETECTION_RULES = [
  {
    id: "vendorTokens",
    singular: "API key",
    plural: "API keys",
    panelLabel: "API keys / tokens",
    patterns: VENDOR_TOKEN_PATTERNS,
    shouldCount: (match) => !isLikelyPlaceholder(match),
  },
  {
    id: "awsAccessKeys",
    singular: "AWS key",
    plural: "AWS keys",
    panelLabel: "AWS access keys",
    patterns: [AWS_ACCESS_KEY_PATTERN],
    shouldCount: () => true,
  },
  {
    id: "googleApiKeys",
    singular: "Google API key",
    plural: "Google API keys",
    panelLabel: "Google API keys",
    patterns: [GOOGLE_API_KEY_PATTERN],
    shouldCount: () => true,
  },
  {
    id: "jwts",
    singular: "JWT",
    plural: "JWTs",
    panelLabel: "JSON Web Tokens",
    patterns: [JWT_PATTERN],
    shouldCount: () => true,
  },
  {
    id: "privateKeys",
    singular: "private key block",
    plural: "private key blocks",
    panelLabel: "Private key blocks",
    patterns: [PEM_PRIVATE_KEY_PATTERN, SSH_ENCRYPTED_PATTERN],
    // De-duplicate: the SSH pattern is a strict subset of the PEM pattern,
    // so any match from the SSH pattern is also matched by the PEM pattern.
    // We keep both for clarity but only count via PEM.
    shouldCount: (_match, _index, allMatches) => {
      // Filter applied at the rule level via dedupedCount below.
      return true;
    },
  },
  {
    id: "inlineCredentials",
    singular: "credential field",
    plural: "credential fields",
    panelLabel: "Inline password/secret fields",
    patterns: [INLINE_CREDENTIAL_PATTERN],
    shouldCount: (match) => {
      const valueMatch = match.match(/[:=]\s*["'`]?([^\n"'`]+)/);
      return valueMatch && !isLikelyPlaceholder(valueMatch[1] ?? "");
    },
  },
  {
    id: "envCredentials",
    singular: "credential env var",
    plural: "credential env vars",
    panelLabel: "Credential env vars",
    patterns: [ENV_CREDENTIAL_PATTERN],
    shouldCount: (match) => {
      const valueMatch = match.match(/=\s*["'`]?([^\n"'`]+)/);
      return valueMatch && !isLikelyPlaceholder(valueMatch[1] ?? "");
    },
  },
  {
    id: "bip39Mnemonics",
    singular: "seed phrase",
    plural: "seed phrases",
    panelLabel: "BIP39 mnemonic phrases",
    // Special-cased counting via countBip39Lines below.
    patterns: [],
    shouldCount: () => true,
  },
];

function collectMatches(content, rule) {
  if (rule.id === "bip39Mnemonics") {
    return countBip39Lines(content);
  }

  // Special-case dedup for private keys: PEM and SSH patterns overlap,
  // so we count unique match positions from the broader (PEM) pattern only.
  if (rule.id === "privateKeys") {
    const matches = content.match(PEM_PRIVATE_KEY_PATTERN);
    return Array.isArray(matches) ? matches.length : 0;
  }

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
    if (left.count !== right.count) return right.count - left.count;
    return left.id.localeCompare(right.id);
  });
  const visible = sorted.slice(0, 2).map(formatSummaryPart);
  if (sorted.length > 2) {
    visible.push(`+${sorted.length - 2} more`);
  }
  return visible.join(" · ");
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
      // Every rule in the new scanner is high-risk by definition: if it
      // matches, sharing the file leaks a real credential. The legacy
      // `highRisk` flag is preserved as `true` for callers that still
      // read it, but the SECRET / PRIVATE / SAFE classification now lives
      // in openclaw-memory-scan.js (riskLevel field).
      highRisk: true,
    });
  }

  const totalCount = findings.reduce((sum, finding) => sum + finding.count, 0);

  return {
    hasSensitive: findings.length > 0,
    highRisk: findings.length > 0,
    totalCount,
    summary: buildSummary(findings),
    findings,
  };
}
