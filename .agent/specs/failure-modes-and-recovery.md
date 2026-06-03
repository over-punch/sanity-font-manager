# Failure Modes & Recovery Strategy

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md), [plan-types.md](./plan-types.md)

---

## Design Principle

Every failure should leave the system in a **known, recoverable state**. The user should always understand what happened, what succeeded, and what they can do about it. No silent data loss or orphaned resources.

---

## Phase 1: Plan Building (Processing)

### F1.1 — fontkit parse failure

**Trigger:** Corrupt font file, unsupported format, or binary that looks like a font but isn't.

**Behavior:**
- Set `FontPlanEntry.status = 'error'` and `error = <message>`
- Continue processing remaining files (do not abort batch)
- Fire `onProgress({ type: 'font-error', tempId, error, progress })`
- Error card appears in the review UI with filename, error reason, and "Remove" action

**Recovery:** User can remove the failed file and continue. Cannot retry — re-add the file via the drop zone if they want to try again.

**Data integrity:** No Sanity writes occurred. No cleanup needed.

### F1.2 — Sanity read failure during existing document resolution

**Trigger:** Network error, API timeout, or auth failure when querying for existing font documents.

**Behavior:**
- Log warning via `console.warn`
- Set `decisions.existingDocument.recommendation = 'create'` (safe default)
- Add a flag: `decisions.existingDocument.lookupFailed = true`
- Show warning badge on the font card: "Could not check for existing documents — will create new"

**Recovery:** User can proceed (safe default is create-new) or fix network and re-process.

**Data integrity:** Worst case: creates a duplicate document that the user will need to merge manually. Better than blocking the entire upload.

### F1.3 — Batch Sanity query returns too many results

**Trigger:** `*[_type == 'font' && typefaceName == $name]` returns hundreds of results for a popular foundry.

**Behavior:**
- Limit to first 200 results (Sanity default pagination)
- Log warning if truncated
- Resolution matching proceeds on the truncated set

**Recovery:** For large font libraries, the user may need to rely on exact ID matching rather than content matching.

### F1.4 — Browser memory pressure

**Trigger:** 200+ large font files (10MB+ VFs) held in memory simultaneously.

**Behavior:**
- No automatic detection (browser may just slow down or crash tab)
- The processing loop is sequential, so only one fontkit buffer is active at a time
- After processing, `fontKit` reference is retained for Phase 2 metadata generation

**Mitigation:**
- Release fontkit parsed objects after extracting needed metadata into the plan entry
- Only re-parse from `File` handle during Phase 2 if metadata generation is needed
- Document a soft recommendation: batches over 100 files should be split into multiple uploads

---

## Phase 2: Execution (Upload)

### F2.1 — Asset upload failure

**Trigger:** Network error, Sanity CDN timeout, rate limit (429), or auth failure during `client.assets.upload()`.

**Behavior:**
- Set `FontExecutionProgress.status = 'error'` and `error = <message>`
- Set `FontExecutionProgress.failedAt = 'asset-upload'`
- Continue to next font in the queue (do not abort batch)
- Fire `onProgress({ type: 'font-error', tempId, error })`
- Font row in Step 4 shows red error icon with message

**Recovery — retry:**
- After batch completes, failed fonts are listed in the summary
- "Retry Failed" button re-runs `executeUploadPlan` for only `status === 'error'` fonts
- Previously uploaded assets are NOT re-uploaded (cached `assetRef` in progress)

**Orphaned assets:** If the asset uploaded successfully but the document creation fails later, the asset exists in Sanity CDN with no document referencing it. This is acceptable — Sanity's asset garbage collection handles orphans eventually. We do NOT attempt to delete the asset on failure (too risky, could delete shared assets).

### F2.2 — CSS generation failure

**Trigger:** fontkit fails to re-parse the woff2 for base64 encoding, or `client.assets.upload` fails for the CSS file.

**Behavior:**
- Set `failedAt = 'css-generation'`
- The font document is still created, but `fileInput.css` will be missing
- Log warning: "CSS generation failed for <title> — document created without CSS"
- Show in summary

**Recovery:** User can regenerate CSS later via the existing "Regenerate CSS Files" utility.

### F2.3 — Font document creation failure

**Trigger:** Sanity write failure — permissions, validation error, or network issue on `client.createOrReplace()` or `client.patch()`.

**Behavior:**
- Set `failedAt = 'document-creation'`
- Assets already uploaded remain (orphaned but harmless)
- Font ref NOT added to the typeface patch list

**Recovery:** Retry button. On retry, asset upload is skipped (cached ref), only document creation is re-attempted.

### F2.4 — Typeface document patch failure

**Trigger:** The final `client.patch(docId).set(patch).commit()` for the typeface document fails.

**Behavior:**
- Set `ExecutionState.error = <message>`
- Set `ExecutionResult.typefacePatchError = <message>`
- All individual font documents were already created successfully
- Summary shows: "24 fonts uploaded successfully, but the typeface document could not be updated"

**Recovery:**
- "Retry Typeface Patch" button that re-runs only the typeface document update
- Font documents exist and are valid — they just aren't linked to the typeface yet
- Manual fallback: user can add font references to the typeface document through the Sanity Studio UI

### F2.5 — Rate limiting (429)

**Trigger:** Too many concurrent requests to Sanity API.

**Behavior:**
- Upload concurrency pool: max 3 concurrent uploads (configurable)
- On 429 response: exponential backoff (1s, 2s, 4s) **with ±25% random jitter** to prevent synchronized retry storms across concurrent slots
- After 3 retries: treat as failed, move to next font

**Implementation:**
```js
const CONCURRENCY_LIMIT = 3;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;
const JITTER_FACTOR = 0.25; // ±25%

function backoffWithJitter(attempt) {
  const base = BASE_BACKOFF_MS * Math.pow(2, attempt);
  const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
  return base + jitter;
}
```

### F2.6 — Tab close / navigation during upload

**Trigger:** User closes tab, navigates away, or browser crashes.

**Behavior:**
- `beforeunload` handler shows browser warning (existing)
- Wake lock prevents screen sleep (existing)
- Modal close button is disabled during execution
- Escape key is intercepted and suppressed during execution

**Data integrity on crash:**
- Fonts that completed before the crash exist as valid documents in Sanity
- Fonts mid-upload have orphaned assets (harmless)
- Typeface document may or may not have been patched (depends on timing)
- No automatic recovery — user must re-upload failed fonts manually

**Recommendation for future:** Consider adding a "last upload status" field to the typeface document that records which fonts were expected, so a future session can detect incomplete uploads.

---

## Idempotency Strategy

The key to safe retries is **cached asset references**:

```
Font upload lifecycle:
  1. Upload TTF asset → cache { ttf: assetRef } in FontExecutionProgress
  2. Upload WOFF2 asset → cache { woff2: assetRef }
  3. Generate CSS → cache { css: assetRef }
  4. Generate metadata → cache in memory
  5. Create/update document using cached refs
```

On retry:
- Steps 1-3: Skip if `assetRef` already cached for that format
- Step 4: Re-run (fast, no network)
- Step 5: Re-run with `createOrReplace` (idempotent by design)

The `FontExecutionProgress.assetRefs` field is a per-format map:

```js
/** @type {Object.<string, string>} - Map of file type → Sanity asset _id */
assetRefs: {}  // e.g. { ttf: 'file-abc123', woff2: 'file-def456', css: 'file-ghi789' }
```

> **Resolved:** `plan-types.md` has been updated to use `assetRefs: Object.<string, string>` (was `assetRef: string|null`).

---

## Error Display Patterns

### During processing (Step 2+3)

```
[Error Card]
┌─────────────────────────────────────────────┐
│ ⚠ MyFont-BoldItalic.ttf                     │
│   Could not parse font: Invalid sfnt version │
│   [Remove from upload]                       │
└─────────────────────────────────────────────┘
```

### During execution (Step 4)

```
[Font Row — Error]
┌─────────────────────────────────────────────┐
│ ✗ Halyard Display Bold                       │
│   Asset upload failed: Network error         │
│   TTF ✓  WOFF2 ✗  CSS —  Doc —              │
└─────────────────────────────────────────────┘
```

### Post-completion summary

```
Upload Complete — 22 of 24 fonts succeeded

✓ Created: 18 new font documents
✓ Updated: 4 existing font documents
✗ Failed: 2 fonts

  - Halyard Display Bold Italic: Asset upload failed (network error)
  - Halyard Text Light: Document creation failed (permission denied)

[Retry Failed (2)]  [Close]
```

### Typeface patch failure

```
⚠ Font documents created, but typeface not updated

24 font documents were created/updated successfully, but the
typeface document could not be patched to reference them.

Error: Permission denied on document typeface-halyard

[Retry Typeface Patch]  [Close]
```

---

## Invariants

These must always hold, regardless of failures:

1. **The plan object is always structurally valid.** Failed fonts have `status: 'error'` but the plan itself is well-formed.
2. **Phase 2 never modifies the plan.** It reads the finalized plan and writes only to `ExecutionState`.
3. **`executeUploadPlan` skips fonts with `status: 'error'`** unless explicitly retried.
4. **The typeface patch includes only successfully created/updated references.** Failed fonts are excluded from `fontRefs` and `variableRefs`.
5. **Asset uploads are never rolled back.** Orphaned assets are acceptable — Sanity handles cleanup.
6. **Document creation uses `createOrReplace`**, making it idempotent on the document level.
7. **Cached asset references survive retry.** Once an asset is uploaded, it is never re-uploaded in the same session.
