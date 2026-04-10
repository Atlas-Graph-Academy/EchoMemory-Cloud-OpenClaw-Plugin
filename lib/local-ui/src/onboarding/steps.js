export const ONBOARDING_STORAGE_KEY = 'echomem-local-ui-onboarding-state';

function hasPendingFiles(ctx) {
  return Number(ctx?.pendingCount || 0) > 0;
}

export function buildTourSteps(ctx) {
  const connected = ctx?.isConnected === true;
  const pending = hasPendingFiles(ctx);

  return [
    {
      id: 'welcome',
      target: 'tour-entry',
      title: 'Welcome to local-ui',
      body: 'Setup stays on the left, local markdown stays in the center, and Echo cloud stays on the right.',
      placement: 'bottom',
      primaryLabel: 'Start tour',
    },
    {
      id: 'setup-rail',
      target: 'setup-header',
      title: 'Setup rail',
      body: 'This sidebar handles connection, sync settings, and plugin maintenance.',
      placement: 'right',
    },
    {
      id: 'quick-setup',
      target: 'quick-setup-card',
      title: 'Quick setup',
      body: 'New users can connect with email here instead of creating a key by hand.',
      placement: 'right',
    },
    {
      id: 'email-connect',
      target: 'email-connect',
      title: connected ? 'Already connected' : 'Email connect',
      body: connected
        ? 'You are already connected. This same area can replace the saved key later.'
        : 'Connect with email starts the one-time verification flow and saves the local key for you.',
      placement: 'right',
    },
    {
      id: 'configuration',
      target: 'configuration-card',
      title: 'Advanced configuration',
      body: 'Use these settings to control which files appear here and how cloud sync behaves.',
      placement: 'right',
      notes: [
        { label: 'API key', text: 'Manual fallback if you manage keys yourself.' },
        { label: 'Memory directory', text: 'Chooses which markdown files appear in the center canvas.' },
        { label: 'Auto sync', text: 'Keeps cloud import running automatically.' },
        { label: 'Echo-only retrieval', text: 'Prefers Echo memory recall over default OpenClaw tools.' },
      ],
    },
    {
      id: 'plugin-updates',
      target: 'plugin-updates-card',
      title: 'Plugin updates',
      body: 'Keep maintenance separate from memory import: check versions, update, and restart here.',
      placement: 'right',
    },
    {
      id: 'topbar',
      target: 'topbar-filters',
      title: 'Topbar orientation',
      body: 'These controls narrow, group, and explain the local file view.',
      placement: 'bottom',
      notes: [
        { label: 'Search', text: 'Searches filenames and file contents locally.' },
        { label: 'Date filters', text: 'Narrow the visible file set by modified date.' },
        { label: 'View mode', text: 'Switches between all files, monthly groups, or weekly groups.' },
        { label: 'Status', text: 'Shows last sync time and cloud connection state.' },
      ],
    },
    {
      id: 'canvas',
      target: 'canvas-root',
      title: 'Smart clusters',
      body: 'This canvas groups your local markdown visually so you can scan journals, knowledge, and system content faster.',
      placement: 'top',
    },
    {
      id: 'cards',
      target: 'representative-card',
      title: 'Cards and badges',
      body: 'Cards show local file state before anything is uploaded to Echo cloud.',
      placement: 'right',
      notes: [
        { label: 'Card title', text: 'Click to focus; double-click to open.' },
        { label: 'Cluster badge', text: 'Shows smart grouping.' },
        { label: 'Private / warning', text: 'Flags privacy-sensitive content before sync.' },
        { label: 'Sync stamp', text: 'Shows new, modified, synced, failed, or sealed state.' },
      ],
    },
    {
      id: 'reading',
      target: 'reading-header',
      title: 'Read and edit',
      body: 'Reading mode lets you inspect markdown, edit locally, and sync to Echo later.',
      placement: 'bottom',
      notes: [
        { label: 'Edit', text: 'Switches to editable markdown.' },
        { label: 'Save', text: 'Writes to the local file only.' },
        { label: 'Back', text: 'Returns to the visual archive.' },
      ],
    },
    {
      id: 'select-files',
      target: 'footer-sync-area',
      title: 'Select files',
      body: pending
        ? 'Select mode works like Dropbox bulk actions: pick only changed files, then sync those.'
        : 'Select mode appears when files are new, modified, or failed. Those states are the files you would bulk sync here.',
      placement: 'top',
      notes: [
        { label: 'Select pending', text: 'Auto-selects files that are new, modified, or failed.' },
        { label: 'Clear', text: 'Resets the current selection.' },
        { label: 'Cancel', text: 'Exits bulk mode.' },
      ],
    },
    {
      id: 'sync',
      target: 'footer-sync-area',
      title: 'Sync memories',
      body: connected
        ? 'Sync uploads local markdown into Echo Cloud and reports progress, failures, and elapsed time.'
        : 'Sync becomes available after connection or manual API key setup.',
      placement: 'top',
    },
    {
      id: 'system-files',
      target: 'system-files-link',
      title: 'System files',
      body: 'System files stay outside the main smart-cluster view so the canvas stays focused on user memory content.',
      placement: 'top',
      allowMissing: true,
    },
    {
      id: 'cloud-rail',
      target: 'cloud-rail',
      title: 'Cloud rail',
      body: 'This sidebar shows what has been imported to Echo cloud, separate from the local canvas.',
      placement: 'left',
    },
    {
      id: 'cloud-memories',
      target: 'cloud-memories-tab',
      title: 'Cloud memories',
      body: 'Use the Memories tab to inspect imported records and jump to their sources.',
      placement: 'left',
      notes: [
        { label: 'Metrics', text: 'Quick count of imported memories.' },
        { label: 'Search', text: 'Searches cloud-side memory records.' },
        { label: 'Memory item', text: 'Open details, jump to source, edit, or delete.' },
        { label: 'Graph link', text: 'Opens the full web graph for deeper exploration.' },
      ],
    },
    {
      id: 'cloud-sources',
      target: 'cloud-sources-tab',
      title: 'Cloud sources',
      body: 'Sources are the evidence behind memories: markdown imports and conversation contexts.',
      placement: 'left',
    },
    {
      id: 'completion',
      target: 'tour-entry',
      title: 'Tour complete',
      body: 'You have seen setup, local browsing, file selection, sync, and cloud verification.',
      placement: 'bottom',
      primaryLabel: connected ? (pending ? 'Select pending' : 'Explore memories') : 'Connect with email',
      notes: [
        { label: 'Next best action', text: connected ? (pending ? 'Select pending and run your first sync.' : 'Open the cloud graph and inspect what is already synced.') : 'Connect with email to unlock sync and cloud browsing.' },
      ],
    },
  ];
}
