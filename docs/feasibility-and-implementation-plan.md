# Echo Memory Cloud OpenClaw Plugin

## Feasibility Evaluation

Date: 2026-03-11

## Executive Summary

The project is feasible with a markdown-only v1.

The recommended v1 scope is:

1. Authenticate the plugin with a user API key.
2. Scan `~/.openclaw/workspace/memory` for markdown files named like `YYYY-MM-DD.md`.
3. Import only `.md` files from that one directory, non-recursively.
4. Write raw file content into `public.source_of_truth`.
5. Extract memories from each file and write them into `public.memory_new`.
6. Keep imported sources and memories linked through both `context_id` and `source_of_truth_ids`.
7. Skip unchanged files and retry failed files on the next sync.

This is materially simpler and lower risk than a dual-source design that also listens to live OpenClaw events.

## Hard Schema Constraint

Per `REFERENCE_TABLE_SCHEMA.md`, imported markdown sources and extracted memories must not use `gold_mine` tables.

Required tables for v1:

- `public.source_of_truth`
- `public.memory_new`
- `public.context`

The plugin will rely on the backend resolving the actual `user_id` from `public.api_keys`.

## Why Markdown-Only V1 Is The Right First Step

The markdown-only scope removes the hardest ambiguity in the earlier plan:

- no conflict between historical import and live event capture
- no need to reconcile `source_of_truth` and `echo."echoMessage"` as competing provenance systems
- no need to design turn-based extraction or session-boundary dedupe
- no need to coordinate `before_agent_start` and `agent_end` extraction timing

For v1, the problem becomes:

- detect changed markdown files
- import only new or updated files
- avoid duplicate memories when a file is reprocessed
- keep source and memory linkage consistent

That is a much cleaner system to ship first.

## What Existing Repos Prove

### 1. Mercury proves the extraction workflow

Mercury is still useful as a workflow reference for:

- markdown/text extraction prompting
- chunking large content
- embedding generation
- semantic dedupe patterns

But Mercury is not the schema template for this project because its relevant flow stages data through `gold_mine`.

### 2. EchoMem-Chrome proves direct public-table ingestion

EchoMem-Chrome already demonstrates the shape we need:

- create a `context`
- write raw content into `public.source_of_truth`
- extract memories
- write to `public.memory_new`
- link with `source_of_truth_ids`

That is the closest reference for v1.

### 3. openclaw-skills proves thin markdown scanning is enough to start

`openclaw-skills` shows that the client-side part can stay simple:

- locate markdown files
- read content
- build ingestion payloads
- send them to a backend endpoint

Its current scanner is minimal, but that is acceptable as a starting point because v1 only scans one fixed directory and `.md` files.

### 4. MemOS-Cloud-OpenClaw-Plugin proves the plugin structure

This repo remains the best structural reference for:

- config loading
- API client separation
- lifecycle plugin packaging
- manifest layout

Even though v1 memory extraction is markdown-only, the plugin can still use the same packaging pattern.

### 5. WebPageReactVersion remains useful for v2

Graph hydration, clustering, labels, and metadata generation are still relevant, but they are not part of v1.

For v1, the system stops after:

- writing `public.source_of_truth`
- writing `public.memory_new`
- preserving linkage

Graph hydration is explicitly deferred to v2.

## V1 Product Decisions Confirmed

### Import Scope

- Default scan root: `~/.openclaw/workspace/memory`
- Only this one root is supported in v1
- No recursive scanning in v1
- Allowed file type: `.md` only
- If the default directory is not found, the plugin may later add fallback discovery for hidden variants, but that is not required for the first implementation

### File Change Detection

The preferred detection strategy is:

- file modified time
- plus full file content hash as a safety check

Additional decisions:

- rename only, with unchanged content: treat as the same logical source
- failed files remain eligible for retry on the next sync
- backend is the source of truth for processed state

### Source-of-Truth Behavior

- extraction unit: one markdown file
- one markdown file maps to one `public.source_of_truth` row unless the file exceeds the chunk limit
- if a file exceeds the max limit, it may be split into multiple `public.source_of_truth` rows
- if a file changes, insert a new `public.source_of_truth` row rather than updating the old row

Field mapping for imported markdown:

- `source = 'openclaw'`
- `source_url = null`
- `file_path = ~/.openclaw/workspace/memory/YYYY-MM-DD.md`
- `section_title = YYYY-MM-DD`
- `is_processed = true` only after the related memories are successfully extracted and linked

### Memory Extraction Semantics

- extraction runs per file
- `public.source_of_truth.content` stores raw file content
- frontmatter is preserved
- code blocks are preserved
- links are preserved
- checklists are preserved
- max file size before chunking/skipping: 1 MB

### Dedupe Policy

- same memory from the same file after a small edit: skip, do not update
- two different files that produce the same memory: keep both memory rows
- `source_of_truth_ids` may contain multiple source ids
- semantic dedupe threshold: `0.8`

### Public Schema Usage

For markdown-imported memories:

- `type = 'third_party'`
- `is_public = false`
- `conversation_id = null`
- `echo_msg_id = null`
- `context_id` is required

For `keys`:

- use the markdown extraction prompt guideline
- target one or two words maximum
- do not exceed two words

### Graph Hydration

V1 does not run graph hydration.

V2 may add:

- scheduled checks for newly imported memories
- clustering / graph refresh after new memory batches exist

### Plugin UX

- import runs on a schedule after installation
- import can also be triggered manually
- periodic sync is required
- plugin should expose import-status
- summary should include:
  - file count
  - skipped count
  - new source count
  - new memory count
  - duplicate count

### Auth / User Identity

- every request relies on API key to resolve `user_id` server-side
- plugin should not cache `user_id` as the source of truth
- plugin should ask the backend implicitly through the key
- a new whoami/profile validation endpoint is needed in the backend

### Failure Handling

- if one file fails, the batch continues
- keep the rule per file as all-or-nothing
- no partial success for a single markdown source file
- failed files remain eligible for automatic retry on the next sync

## Schema-Aligned Write Model

### `public.context`

V1 should create a context row for each imported file version.

This gives one stable linkage object connecting:

- one imported source row or source chunk set
- all extracted memories produced from that file version

### `public.source_of_truth`

Use this table for raw imported file content.

Populate:

- `user_id`
- `content`
- `source_created_at`
- `source = 'openclaw'`
- `source_url = null`
- `file_path`
- `section_title`
- `context_id`
- `is_processed`

### `public.memory_new`

Use this as the only memory destination table.

Populate:

- `user_id`
- `time`
- `location`
- `category`
- `object`
- `emotion`
- `description`
- `details`
- `description_embedding`
- `category_object_emotion_embedding`
- `is_public = false`
- `keys`
- `source_of_truth_ids`
- `type = 'third_party'`
- `context_id`
- `conversation_id = null`
- `echo_msg_id = null`
- `updated_at`

## Recommended Processing Model

For each file:

1. Read the local markdown file.
2. Compute normalized content hash and observe modified time.
3. Ask backend whether this logical source version already exists or has already been processed.
4. If unchanged, skip.
5. If changed or new, create a new `context`.
6. Write one or more `public.source_of_truth` rows.
7. Extract memories from the file.
8. Dedupe candidate memories against existing `public.memory_new`.
9. Insert only non-duplicate memories.
10. Mark the related `public.source_of_truth` rows as processed.

## Important Implementation Assumption

Changed-section-only extraction is desirable, but not required to make v1 viable.

The buildable baseline is:

- detect changes with modified time plus content hash
- treat the whole file as the extraction unit
- dedupe memory rows before insert

If efficient diff extraction is available during implementation, it can be added. If not, full-file re-extraction with strong dedupe is still acceptable for v1.

## Feasibility Verdict

The markdown-only v1 is feasible and implementation-ready.

The main work is no longer architecture discovery. It is now productized execution:

- plugin scaffold
- API key validation
- fixed-directory markdown scanning
- file-change detection
- backend ingestion endpoint
- extraction and dedupe
- status reporting

That is a realistic first build.

## Recommended Next Step

Proceed with implementation against the markdown-only v1 plan, and defer both live event capture and graph hydration to later versions.
