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
      id: 'setup',
      target: 'setup-header',
      title: 'Setup rail',
      body: 'Start on the left: quick connect, local settings, and plugin upkeep all live here.',
      placement: 'right',
      notes: [
        { label: 'Quick setup', text: 'Fastest path for new users: email, code, connected.' },
        { label: 'Plugin updates', text: 'Version checks and gateway restart stay here, not in sync.' },
      ],
    },
    {
      id: 'connect-config',
      target: 'configuration-card',
      title: connected ? 'Connection and config' : 'Connect and configure',
      body: connected
        ? 'You are already connected. This area still lets you replace the saved key and tune local behavior.'
        : 'Connect with email or use a manual key, then choose how local files and sync should behave.',
      placement: 'right',
      notes: [
        { label: 'Email connect', text: connected ? 'Replaces the saved key later if needed.' : 'One-time verification without manual API key setup.' },
        { label: 'API key', text: 'Manual fallback if you manage keys yourself.' },
        { label: 'Memory directory', text: 'Chooses which markdown files appear in the center canvas.' },
        { label: 'Auto sync', text: 'Keeps cloud import running automatically.' },
        { label: 'Echo-only retrieval', text: 'Prefers Echo memory recall over default OpenClaw tools.' },
      ],
    },
    {
      id: 'local-map',
      target: 'topbar-filters',
      title: 'Topbar and local map',
      body: 'Use the topbar to narrow the file set, then scan the center canvas as your local markdown map.',
      placement: 'bottom',
      notes: [
        { label: 'Search', text: 'Searches filenames and file contents locally.' },
        { label: 'Date filters', text: 'Narrow the visible file set by modified date.' },
        { label: 'View mode', text: 'Switches between all files, monthly groups, or weekly groups.' },
        { label: 'System files', text: 'Stay separate so the main canvas stays focused on user memory content.' },
      ],
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
      id: 'sync',
      target: pending ? 'footer-select-controls' : 'footer-sync-area',
      title: 'Select and sync',
      body: connected
        ? (pending
            ? 'Select mode works like Dropbox bulk actions: pick changed files, then sync them to Echo Cloud.'
            : 'This footer is where changed files become bulk actions and sync actions.')
        : 'This footer is where you select changed files and sync once cloud connection is ready.',
      placement: 'top',
      notes: [
        { label: 'Select pending', text: 'Auto-selects files that are new, modified, or failed.' },
        { label: 'Clear', text: 'Resets the current selection.' },
        { label: 'Cancel', text: 'Exits bulk mode.' },
        { label: 'Sync', text: connected ? 'Uploads local markdown and reports progress or failures.' : 'Becomes available after connection or manual API key setup.' },
      ],
    },
    {
      id: 'cloud',
      target: 'cloud-panel',
      title: 'Cloud sidebar',
      body: 'The right sidebar is the cloud view, kept separate from the local canvas so imported data is obvious.',
      placement: 'left',
      notes: [
        { label: 'Metrics', text: 'Quick count of imported memories.' },
        { label: 'Search', text: 'Searches cloud-side memory records.' },
        { label: 'Memory item', text: 'Open details, jump to source, edit, or delete.' },
        { label: 'Graph link', text: 'Opens the full web graph for deeper exploration.' },
      ],
    },
    {
      id: 'sources',
      target: 'cloud-sources-panel',
      title: 'Sources tab',
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
