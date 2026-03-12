# Echo Memory Cloud OpenClaw Plugin

## Implementation Plan

Date: 2026-03-11

## Goal

Build a markdown-only v1 that imports OpenClaw local memory markdown files into Echo backend storage using:

- `public.context`
- `public.source_of_truth`
- `public.memory_new`

The plugin should:

- authenticate with API key
- validate the API key with a backend endpoint
- periodically scan `~/.openclaw/workspace/memory`
- import only new or changed `.md` files
- expose import status

V1 does not implement:

- live event capture
- `echo."echoMessage"` writes
- graph hydration

## Functional Scope

### In Scope

- plugin packaging and manifests
- config loading
- API key validation
- fixed-path markdown scan
- non-recursive `.md` import
- modified time plus content hash detection
- backend-driven processed-state lookup
- file import endpoint
- all-or-nothing extraction per file
- memory dedupe
- periodic sync
- manual sync trigger
- import status reporting

### Out Of Scope

- session-based live capture
- conversation extraction
- event listeners
- graph refresh
- cluster hydration
- multi-root scanning
- recursive vault import

## Planned Repo Structure

Suggested initial file layout:

- `index.js`
- `lib/config.js`
- `lib/api-client.js`
- `lib/openclaw-memory-scan.js`
- `lib/hash.js`
- `lib/scheduler.js`
- `openclaw.plugin.json`
- `moltbot.plugin.json`
- `clawdbot.plugin.json`
- `package.json`
- `scripts/sync-version.js`
- `docs/feasibility-and-implementation-plan.md`
- `docs/implementation-plan.md`

## Plugin Responsibilities

### 1. Configuration

Read:

- `ECHOMEM_BASE_URL`
- `ECHOMEM_API_KEY`

Optional config:

- sync interval
- auto-sync enabled
- import batch size

Hardcoded v1 scan root:

- `~/.openclaw/workspace/memory`

### 2. API Key Validation

On startup or setup:

1. call new backend whoami/profile endpoint
2. validate API key
3. receive resolved user identity from backend

The plugin should not trust client-supplied `user_id`.

### 3. Markdown Scan

For the fixed root:

- list files in the top-level directory only
- filter to `.md`
- sort deterministically, preferably by filename

Expected naming convention:

- `YYYY-MM-DD.md`

### 4. File Change Detection

For each file:

- read modified time
- read file content
- compute content hash

Then send metadata to backend for processed-state resolution.

### 5. Import Modes

Support:

- periodic sync
- manual sync
- import status query

## Backend Responsibilities

### 1. Auth

Resolve API key to `user_id` using `public.api_keys`.

### 2. Whoami Endpoint

Add a new authenticated endpoint that returns:

- resolved `user_id`
- display info if available
- auth validity

Purpose:

- plugin setup validation
- simple connectivity check

### 3. Markdown Import Endpoint

Add a backend endpoint, for example:

- `POST /api/openclaw/v1/import-markdown`

Request payload per file should include:

- `filePath`
- `sectionTitle`
- `content`
- `modifiedTime`
- `contentHash`

Behavior:

1. resolve `user_id` from API key
2. determine whether file version is already processed
3. if unchanged, return skipped
4. if changed, create a new `context`
5. write one or more `public.source_of_truth` rows
6. extract memories from the file
7. dedupe against `public.memory_new`
8. insert only non-duplicate memories
9. mark written source rows `is_processed = true`
10. return import result summary

### 4. Import Status Endpoint

Add endpoint, for example:

- `GET /api/openclaw/v1/import-status`

Return:

- last run time
- file count
- skipped count
- new source count
- new memory count
- duplicate count
- failed file count
- failed file paths if available

## Data Model Rules

### Context

Create one `public.context` row per imported file version.

Reason:

- clean linkage for all `source_of_truth` rows from one file version
- clean linkage for all `memory_new` rows extracted from that file version

### Source Rows

Primary mapping:

- one file version -> one `source_of_truth` row

If file exceeds size constraints:

- split deterministically into multiple `source_of_truth` rows
- all chunks share the same `context_id`

Populate:

- `user_id`
- `content`
- `source_created_at`
- `source = 'openclaw'`
- `source_url = null`
- `file_path`
- `section_title`
- `context_id`
- `is_processed = false` at first

### Memory Rows

Populate:

- `user_id`
- `time`
- extracted semantic fields
- embeddings
- `is_public = false`
- `keys`
- `source_of_truth_ids`
- `type = 'third_party'`
- `context_id`
- `conversation_id = null`
- `echo_msg_id = null`

## Dedupe Strategy

### Source-Level Dedupe

Treat a file as unchanged when:

- logical source identity matches
- content hash matches
- and file version has already been processed

Rename-only case:

- unchanged content should be treated as the same logical source

### Memory-Level Dedupe

Per candidate memory:

1. exact normalized text check on:
   - `user_id`
   - `description`
   - `details`
2. semantic similarity check on `description_embedding`
   - threshold `0.8`

Rules:

- duplicate from same file after small edit: skip
- duplicate from different file: keep as separate memory row

## Failure Model

Per file, use all-or-nothing extraction:

- if extraction for a file fails, do not persist partial memory results for that file
- continue processing other files in the batch
- failed files remain eligible on the next sync

## Sync Model

### Automatic Sync

- periodic sync after installation
- interval configurable later, but v1 should support scheduler plumbing

### Manual Sync

- explicit command or trigger
- runs the same import pipeline immediately

### Status

Expose import status command that reads backend summary.

## Suggested Build Order

### Phase 1. Plugin Scaffold

- package metadata
- manifests
- config loader
- API client skeleton

### Phase 2. Auth Validation

- backend whoami endpoint
- plugin validation call
- startup auth checks

### Phase 3. Markdown Scan

- fixed root resolution
- top-level `.md` discovery
- deterministic ordering
- file metadata capture

### Phase 4. Import Endpoint

- payload contract
- backend user resolution
- processed-state decision
- context creation
- `source_of_truth` write

### Phase 5. Extraction And Dedupe

- markdown extraction prompt integration
- embeddings
- duplicate checks
- `memory_new` insert
- mark `source_of_truth.is_processed = true`

### Phase 6. Scheduler And Status

- periodic sync trigger
- manual trigger
- import summary and status endpoint

## Key Implementation Assumptions

- backend remains the source of truth for processed state
- content hash plus modified time is sufficient for v1 change detection
- changed-section-only extraction is optional, not required for first implementation
- v1 stops before graph hydration

## Deliverable For Coding Start

Implementation can begin once the first coding pass targets:

- plugin scaffold
- whoami endpoint
- import endpoint contract
- scan logic
- status endpoint skeleton

That is enough to start building incrementally without reopening architecture questions.
