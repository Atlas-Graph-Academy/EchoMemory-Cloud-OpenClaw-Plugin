#!/usr/bin/env node
/**
 * Runs before `npm publish` / `npm pack` to guarantee that the local UI
 * bundle we ship in `lib/local-ui/dist/` is up to date with the current
 * `@echomem/memory_log_ui` source.
 *
 * Flow:
 *   1. Verify the sibling `EchoMemory_log` repo is checked out (it provides
 *      the UI package via a `file:` dep in lib/local-ui/package.json).
 *   2. Run `npm install` inside lib/local-ui so the symlink is fresh.
 *   3. Run `npm run build` inside lib/local-ui to rebuild dist/.
 *
 * Why this exists: the published tarball ONLY ships lib/local-ui/dist/ (no
 * source, no package.json, no node_modules). End-users never need
 * @echomem/memory_log_ui at runtime — Vite has already inlined it. But if
 * we publish with a stale dist/, users are stuck on old UI code. This hook
 * makes "forget to rebuild" impossible.
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { execSync } from 'node:child_process';

const rootDir = process.cwd();
const siblingUiPackage = resolve(rootDir, '..', 'EchoMemory_log', 'packages', 'memory_log_ui');

if (!existsSync(siblingUiPackage)) {
  console.error('\n[prepack] Missing sibling repo.');
  console.error(`[prepack] Expected: ${siblingUiPackage}`);
  console.error('[prepack] Clone Atlas-Graph-Academy/EchoMemory_log next to this repo, then retry.\n');
  process.exit(1);
}

const localUiDir = resolve(rootDir, 'lib', 'local-ui');
if (!existsSync(resolve(localUiDir, 'package.json'))) {
  console.error(`[prepack] Missing lib/local-ui/package.json at ${localUiDir}`);
  process.exit(1);
}

console.log('[prepack] Installing lib/local-ui dependencies ...');
execSync('npm install', { cwd: localUiDir, stdio: 'inherit' });

console.log('[prepack] Rebuilding lib/local-ui dist ...');
execSync('npm run build', { cwd: localUiDir, stdio: 'inherit' });

console.log('[prepack] lib/local-ui/dist is fresh. Proceeding with publish.');
