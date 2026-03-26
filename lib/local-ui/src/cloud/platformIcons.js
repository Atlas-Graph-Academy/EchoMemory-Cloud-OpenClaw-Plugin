const PLATFORM_COLORS = {
  chatgpt: '#10a37f',
  claude: '#d97706',
  gemini: '#4285f4',
  grok: '#1d9bf0',
  perplexity: '#20b2aa',
  deepseek: '#4f6df5',
  qwen: '#6d28d9',
  copilot: '#0078d4',
  mistral: '#ff7000',
  lechat: '#ff7000',
  echochat: '#7aae5e',
  openclaw: '#4285f4',
};

const PLATFORM_LABELS = {
  chatgpt: 'ChatGPT',
  claude: 'Claude',
  gemini: 'Gemini',
  grok: 'Grok',
  perplexity: 'Perplexity',
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  copilot: 'Copilot',
  mistral: 'Mistral',
  lechat: 'Mistral Le Chat',
  mcp_server: 'MCP Server',
  echochat: 'EchoChat',
  openclaw: 'OpenClaw',
};

const PLATFORM_ICONS = {
  chatgpt: '/assets/platform_icons/ChatGPT-Logo.png',
  claude: '/assets/platform_icons/Claude-Logo.png',
  gemini: '/assets/platform_icons/Gemini-Logo.png',
  grok: '/assets/platform_icons/Grok-Logo.png',
  perplexity: '/assets/platform_icons/Perplexity-Logo.png',
  deepseek: '/assets/platform_icons/DeepSeek-Logo.png',
  qwen: '/assets/platform_icons/Qwen-Logo.png',
  copilot: '/assets/platform_icons/Copilot-Logo.png',
  mistral: '/assets/platform_icons/Mistral-Logo.png',
  lechat: '/assets/platform_icons/Mistral-Logo.png',
  mcp_server: '/assets/platform_icons/MCP-Logo.png',
  echochat: '/assets/icon32.png',
  openclaw: '/assets/platform_icons/OpenClaw-Logo.png',
};

function letterSvgDataUri(letter, bgColor) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="${bgColor}"/>
    <text x="16" y="22" text-anchor="middle" font-family="system-ui,sans-serif" font-size="18" font-weight="600" fill="#fff">${letter}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function normalisePlatformKey(raw) {
  const lower = String(raw || '').toLowerCase().trim();

  if (lower.startsWith('chrome_extension_')) {
    return lower.replace('chrome_extension_', '');
  }
  if (lower.includes('echochat') || lower.includes('echo chat') || lower === 'echochat conversation') {
    return 'echochat';
  }
  if (lower.includes('openclaw') || lower.includes('open claw')) {
    return 'openclaw';
  }
  if (lower === 'mcp server' || lower === 'mcp-server' || lower === 'mcp') {
    return 'mcp_server';
  }
  if (lower.includes('mcp')) {
    return 'mcp_server';
  }
  if (lower === 'qwen.chat' || lower === 'qwenchat') {
    return 'qwen';
  }
  if (lower in PLATFORM_LABELS) {
    return lower;
  }
  for (const key of Object.keys(PLATFORM_LABELS)) {
    if (lower.includes(key)) {
      return key;
    }
  }
  return lower;
}

export function getPlatformIcon(source) {
  if (!source) return null;

  const key = normalisePlatformKey(source);
  const label = PLATFORM_LABELS[key] || source;
  const iconSrc = PLATFORM_ICONS[key];

  if (iconSrc) {
    return { key, label, iconSrc };
  }

  const color = PLATFORM_COLORS[key] || '#6b7280';
  return {
    key,
    label,
    iconSrc: letterSvgDataUri(label.charAt(0).toUpperCase(), color),
  };
}
