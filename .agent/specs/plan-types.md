# Plan Object Type Definitions

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md)

This document is the single source of truth for the data structures used by the upload modal. All components, the reducer, and both orchestrator functions (`buildUploadPlan`, `executeUploadPlan`) must conform to these types.

These are defined as JSDoc typedefs for now (the codebase is JS/JSX). If the project migrates to TypeScript, convert these to interfaces/types in a `planTypes.ts` file.

---

## PlanObject

The top-level state managed by the modal. Split into two separate state containers to avoid re-render coupling:

```js
/**
 * @typedef {Object} UploadPlan
 * @property {number} version - Schema version for future migrations (starts at 1)
 * @property {PlanSettings} settings - Global upload settings
 * @property {Object.<string, FontPlanEntry>} fonts - Map of tempId → font entry
 * @property {Object.<string, SubfamilyGroup>} subfamilyGroups - Map of subfamily name → group
 * @property {'idle' | 'processing' | 'reviewing' | 'ready' | 'executing' | 'complete' | 'error'} phase - Current modal phase
 * @property {PlanProcessingProgress} processingProgress - Phase 1 processing progress
 */

/**
 * Execution progress lives in a SEPARATE state container (useRef or separate useReducer)
 * to prevent Phase 2 progress ticks from re-rendering the plan/review UI.
 *
 * @typedef {Object} ExecutionState
 * @property {'idle' | 'uploading' | 'patching-typeface' | 'complete' | 'error'} status
 * @property {Object.<string, FontExecutionProgress>} progress - Map of tempId → per-font progress
 * @property {string|null} error - Global execution error, if any
 */
```

---

## PlanSettings

```js
/**
 * @typedef {Object} PlanSettings
 * @property {number} price - Price in dollars (0 = free). Valid range: 0-9999.
 * @property {boolean} preserveShortenedNames - Keep abbreviations as-is (e.g. "Bd" stays "Bd")
 * @property {boolean} preserveFileNames - Derive title/ID from original filename instead of fontkit metadata
 */
```

---

## FontPlanEntry

Each uploaded font gets one entry. Multiple file formats (TTF + WOFF2 etc.) for the same font share one entry.

```js
/**
 * @typedef {Object} FontPlanEntry
 * @property {string} tempId - Stable identifier for this entry within the plan. Generated as `sanitizeForSanityId(fontTitle) + '-' + nanoid(6)` to guarantee uniqueness even when two fonts resolve to the same title.
 * @property {File[]} files - Raw font files (TTF, OTF, WOFF, WOFF2, etc.) grouped by identity. Multiple formats of the same font = one entry with multiple files.
 * @property {string} sourceFileName - Original filename of the primary file (TTF/OTF preferred)
 *
 * --- Derived metadata (all editable by user) ---
 * @property {string} title - Font title (e.g. "Halyard Display Bold Italic")
 * @property {string} documentId - Sanity document _id (derived from title via sanitizeForSanityId, or user override)
 * @property {number} weight - CSS font-weight value. OS/2 usWeightClass range: 1-1000 (not restricted to 100-step increments)
 * @property {string} weightName - Human-readable weight name ("Bold", "Light", etc.)
 * @property {'Regular' | 'Italic'} style - Font style
 * @property {string} subfamily - Subfamily grouping ("Display", "Text", "Narrow", etc.). Empty string for variable fonts unless they represent a specific optical size.
 * @property {boolean} variableFont - Whether this is a variable font (has variation axes with actual ranges)
 * @property {string|null} originalFilename - Original filename without extension (when preserveFileNames is on)
 *
 * --- Decision audit trail ---
 * @property {FontDecisions} decisions - How each value was derived, with alternatives and overrides
 *
 * --- Processing state ---
 * @property {'pending' | 'processing' | 'processed' | 'error'} status
 * @property {string|null} error - Processing error message, if any
 *
 * --- Validation flags ---
 * @property {boolean} [_idConflict] - True when documentId collides with another font in the batch
 *
 * --- Parsed data (read-only, not editable) ---
 * @property {FontMetadataSnapshot|null} parsedMetadata - Extracted metadata from fontkit (see below). The raw fontkit object is NOT retained — only the fields needed for Phase 2 and UI display.
 * @property {number} glyphCount - Number of glyphs (informational, shown in review card)
 * @property {string[]} opentypeFeatures - List of OpenType feature tags (informational)
 * @property {VariationAxisMap|null} variationAxes - Variable font axes keyed by tag (e.g. { wght: { min, max, default }, ital: { ... } })
 */
```

### File grouping rules

- Files are grouped by **derived font identity** (same title after processing).
- A single `FontPlanEntry` may contain 1-4 files (e.g., TTF + OTF + WOFF + WOFF2 of "Halyard Bold").
- A variable font is always one entry per VF file (VFs are not grouped with static fonts).
- If two files resolve to the same `documentId`, they are merged into one entry's `files[]`.

---

## FontDecisions

The audit trail for every automated decision. Each sub-object tracks what the system chose, why, what alternatives exist, and what the user overrode.

```js
/**
 * @typedef {Object} FontDecisions
 * @property {TitleDecision} title
 * @property {DocumentIdDecision} documentId
 * @property {WeightDecision} weight
 * @property {WeightNameDecision} weightName
 * @property {StyleDecision} style
 * @property {SubfamilyDecision} subfamily
 * @property {ExistingDocumentDecision} existingDocument
 */

/**
 * @typedef {Object} TitleDecision
 * @property {'fontkit-fullName' | 'fontkit-preferredFamily' | 'fontkit-preferredFamily+preferredSubfamily' | 'filename' | 'user-override'} source - Where the active title came from
 * @property {string} original - Raw fontkit.fullName before any processing
 * @property {string} processed - Title after formatting, abbreviation expansion, italic appending
 * @property {TitleAlternative[]} alternatives - Other possible titles from different metadata sources
 * @property {string|null} userOverride - User's manual edit (null = accepted system suggestion)
 */

/**
 * @typedef {Object} TitleAlternative
 * @property {string} value - The alternative title string
 * @property {'nameId1-familyName' | 'nameId4-fullName' | 'nameId6-postscriptName' | 'nameId16-preferredFamily' | 'nameId17-preferredSubfamily' | 'filename'} source - Which metadata field this came from
 */

/**
 * @typedef {Object} DocumentIdDecision
 * @property {'derived-from-title' | 'derived-from-filename' | 'user-override'} source
 * @property {string} generated - Auto-generated ID from sanitizeForSanityId(title)
 * @property {string|null} userOverride
 */

/**
 * @typedef {Object} WeightDecision
 * @property {'os2-usWeightClass' | 'keyword-match' | 'default-400' | 'user-override'} source
 * @property {number} detected - System-detected weight value
 * @property {string|null} matchedKeyword - Which keyword triggered the match (e.g. "semibold"), null if OS/2
 * @property {string|null} rawWeightName - Original weight name string before mapping
 * @property {number|null} userOverride
 */

/**
 * @typedef {Object} StyleDecision
 * @property {'os2-fsSelection-italic' | 'head-macStyle-italic' | 'name-contains-italic' | 'italic-angle' | 'default-regular' | 'user-override'} source
 * @property {'Regular' | 'Italic'} detected
 * @property {string} reason - Human-readable explanation (e.g. "italicAngle = -12")
 * @property {'Regular' | 'Italic' | null} userOverride
 */

/**
 * @typedef {Object} WeightNameDecision
 * @property {string} detected - System-detected weight name
 * @property {string|null} userOverride
 */

/**
 * @typedef {Object} SubfamilyDecision
 * @property {'preferredFamily-subtraction' | 'fullName-subtraction' | 'default-empty' | 'cleared-by-opsz' | 'user-override'} source - How the value was derived
 * @property {string} detected - System-detected subfamily (pre-clearing value if opsz cleared it)
 * @property {string|null} userOverride
 */

/**
 * @typedef {Object} ExistingDocumentDecision
 * @property {'use-exact' | 'use-candidate' | 'ambiguous' | 'create'} recommendation - System recommendation
 * @property {ExistingDocMatch|null} exact - Exact ID/slug match from Sanity (null if none)
 * @property {ExistingDocMatch[]} candidates - Content-match candidates from Sanity
 * @property {'create' | 'update' | null} userChoice - User's explicit override (null = accept recommendation)
 * @property {ExistingDocMatch|null} selectedCandidate - Which existing doc to update (if user chose 'update')
 * @property {boolean} [lookupFailed] - True if the Sanity query failed (network/auth) — recommendation defaults to 'create'
 */

/**
 * @typedef {Object} ExistingDocMatch
 * @property {string} _id - Sanity document ID
 * @property {string} title - Font title
 * @property {number} weight
 * @property {'Regular' | 'Italic'} style
 * @property {string} subfamily
 * @property {boolean} variableFont
 * @property {'id' | 'slug' | 'content'} matchType - How this match was found
 */
```

---

## SubfamilyGroup

```js
/**
 * @typedef {Object} SubfamilyGroup
 * @property {string} title - Subfamily display name (e.g. "Display", "Text")
 * @property {string[]} fontIds - tempId references into the fonts map. Referential integrity: every ID here MUST exist in plan.fonts.
 */
```

### Invariants

- Every `fontId` in any `SubfamilyGroup.fontIds` must exist as a key in `plan.fonts`.
- Every non-VF font's `subfamily` value must correspond to a key in `plan.subfamilyGroups`.
- VF fonts with empty subfamily are not assigned to any group.

---

## Processing Progress

```js
/**
 * @typedef {Object} PlanProcessingProgress
 * @property {number} total - Total number of files to process
 * @property {number} completed - Number successfully processed
 * @property {number} failed - Number that failed processing
 * @property {string|null} currentFile - Filename currently being processed
 */
```

---

## Execution Progress (separate state)

```js
/**
 * @typedef {Object} FontExecutionProgress
 * @property {'queued' | 'uploading-assets' | 'generating-css' | 'generating-metadata' | 'creating-document' | 'complete' | 'error' | 'skipped'} status
 * @property {string|null} currentFile - Which format is currently uploading (e.g. "ttf", "woff2")
 * @property {number} filesComplete - How many file formats have been uploaded
 * @property {number} filesTotal - Total file formats to upload
 * @property {Object.<string, string>} assetRefs - Map of file format → Sanity asset _id (e.g. { ttf: 'file-abc', woff2: 'file-def', css: 'file-ghi' }). Used for idempotent retry — skip re-upload of already-cached formats.
 * @property {string|null} error - Error message if status is 'error'
 */
```

---

## ExecutionResult

Returned by `executeUploadPlan()`.

```js
/**
 * @typedef {Object} ExecutionResult
 * @property {boolean} success - True if all fonts uploaded without error
 * @property {number} created - Number of new font documents created
 * @property {number} updated - Number of existing font documents updated
 * @property {number} failed - Number of fonts that failed
 * @property {number} skipped - Number of fonts skipped (status was 'error' from processing)
 * @property {FailedFont[]} failedFonts - Details of failures
 * @property {SanityReference[]} fontRefs - Sanity references for newly created/updated fonts
 * @property {SanityReference[]} variableRefs - Sanity references for variable fonts
 * @property {string|null} typefacePatchError - Error from the final typeface document patch, if any
 */

/**
 * @typedef {Object} FailedFont
 * @property {string} tempId
 * @property {string} title
 * @property {string} error - Error message
 * @property {'asset-upload' | 'css-generation' | 'metadata-generation' | 'document-creation'} failedAt - Which step failed
 */
```

---

## Orchestrator Function Signatures

```js
/**
 * Phase 1: Reads font files, parses metadata, resolves existing documents,
 * returns a complete upload plan for user review.
 *
 * NOTE: This function performs Sanity READ operations (existing document lookups)
 * but NO writes. The client parameter is used for reads only.
 *
 * @param {Object} params
 * @param {File[]} params.files - Sorted font files
 * @param {string} params.typefaceTitle - Parent typeface title
 * @param {string} params.docId - Typeface document _id (used for scoping batch GROQ query)
 * @param {PlanSettings} params.settings
 * @param {Object} params.client - Sanity client (read-only usage)
 * @param {TypefaceStyles} params.stylesObject - Existing typeface styles
 * @param {ProcessingProgressCallback} params.onProgress
 * @returns {Promise<UploadPlan>}
 */

/**
 * Resolves whether a font document already exists in Sanity.
 *
 * Resolution strategies (in priority order):
 *   1. Exact _id match, draft _id match, or slug.current match
 *   2. Content match by typefaceName + weightName + style + subfamily + variableFont
 *
 * @param {Object} font - { _id, typefaceName, weightName, style, subfamily, variableFont }
 * @param {Object} client - Sanity client (parameterized queries only)
 * @returns {Promise<{ exact: Object|null, candidates: Object[], recommendation: 'use-exact'|'use-candidate'|'ambiguous'|'create', lookupFailed?: boolean }>}
 */

/**
 * Phase 2: Executes a finalized plan — uploads assets, creates/updates
 * font documents, patches the typeface document.
 *
 * Skips fonts with status 'error'. Caches asset references in progress
 * for idempotent retry on partial failure.
 *
 * @param {Object} params
 * @param {UploadPlan} params.plan - The reviewed and finalized plan
 * @param {Object} params.client - Sanity client
 * @param {string} params.docId - Typeface document ID
 * @param {TypefaceStyles} params.stylesObject - Existing typeface styles
 * @param {ExecutionProgressCallback} params.onProgress
 * @returns {Promise<ExecutionResult>}
 */
```

---

## Callback Types

```js
/**
 * Called during Phase 1 processing. Used by the component to dispatch
 * ADD_PROCESSED_FONT or SET_PROCESSING_ERROR actions.
 *
 * @callback ProcessingProgressCallback
 * @param {ProcessingProgressEvent} event
 */

/**
 * @typedef {Object} ProcessingProgressEvent
 * @property {'font-processed' | 'font-error' | 'processing-complete'} type
 * @property {string} [tempId] - Which font (for font-processed and font-error)
 * @property {FontPlanEntry} [fontEntry] - The processed font data (for font-processed)
 * @property {string} [error] - Error message (for font-error)
 * @property {PlanProcessingProgress} progress - Overall progress counts
 */

/**
 * Called during Phase 2 execution. Used by the component to update
 * the separate ExecutionState.
 *
 * @callback ExecutionProgressCallback
 * @param {ExecutionProgressEvent} event
 */

/**
 * @typedef {Object} ExecutionProgressEvent
 * @property {'font-upload-start' | 'file-uploaded' | 'css-generated' | 'metadata-generated' | 'document-created' | 'font-complete' | 'font-error' | 'typeface-patched' | 'execution-complete'} type
 * @property {string} [tempId]
 * @property {FontExecutionProgress} [fontProgress]
 * @property {string} [error]
 */
```

---

## TypefaceStyles (external Sanity data)

This is the shape of `stylesObject` — the existing typeface document's `styles` field, read from Sanity via `useFormValue(['styles'])`.

```js
/**
 * @typedef {Object} TypefaceStyles
 * @property {SanityReference[]} [fonts] - Existing font references
 * @property {SanityReference[]} [variableFont] - Existing variable font references
 * @property {SubfamilyEntry[]} [subfamilies] - Existing subfamily groups (see SubfamilyEntry below)
 * @property {SanityReference[]} [collections] - Must be preserved (dot-path patch)
 * @property {SanityReference[]} [pairs] - Must be preserved (dot-path patch)
 * @property {SanityReference[]} [free] - Must be preserved (dot-path patch)
 * @property {Object[]} [displayStyles] - Must be preserved (dot-path patch)
 */

/**
 * @typedef {Object} SubfamilyEntry
 * @property {string} _key
 * @property {'object'} _type
 * @property {string} title - Subfamily display name
 * @property {SanityReference[]} fonts - Font references in this group
 */

/**
 * @typedef {Object} FontMetadataSnapshot
 * @property {string} postscriptName
 * @property {string} fullName
 * @property {string} familyName
 * @property {string} subfamilyName
 * @property {string} copyright
 * @property {string} version
 * @property {number} unitsPerEm
 * @property {number} ascender
 * @property {number} descender
 * @property {number} lineGap
 * @property {number} italicAngle
 * @property {number} capHeight
 * @property {number} xHeight
 * @property {Object} boundingBox
 */

/**
 * @typedef {Object} VariationAxis
 * @property {number} min
 * @property {number} max
 * @property {number} default
 * @property {string} [name]
 */

/** @typedef {Object.<string, VariationAxis>} VariationAxisMap */

/**
 * @typedef {Object} SanityReference
 * @property {string} _key
 * @property {'reference'} _type
 * @property {string} _ref
 * @property {boolean} [_weak]
 */
```

---

## Status Enums

For runtime safety, export these as const objects so comparisons can use `STATUS.PENDING` instead of raw strings:

```js
/** @enum {string} */
export const FONT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  ERROR: 'error',
};

/** @enum {string} */
export const PLAN_PHASE = {
  IDLE: 'idle',
  PROCESSING: 'processing',
  REVIEWING: 'reviewing',
  READY: 'ready',
  EXECUTING: 'executing',
  COMPLETE: 'complete',
  ERROR: 'error',
};

/** @enum {string} */
export const RECOMMENDATION = {
  USE_EXACT: 'use-exact',
  USE_CANDIDATE: 'use-candidate',
  AMBIGUOUS: 'ambiguous',
  CREATE: 'create',
};

/** @enum {string} */
export const EXECUTION_STATUS = {
  QUEUED: 'queued',
  UPLOADING_ASSETS: 'uploading-assets',
  GENERATING_CSS: 'generating-css',
  GENERATING_METADATA: 'generating-metadata',
  CREATING_DOCUMENT: 'creating-document',
  PATCHING_TYPEFACE: 'patching-typeface',
  COMPLETE: 'complete',
  ERROR: 'error',
  SKIPPED: 'skipped',
};

/** Processing-owned fields — only written by ADD_PROCESSED_FONT, never by user edit actions */
export const PROCESSING_OWNED_FIELDS = ['parsedMetadata', 'glyphCount', 'opentypeFeatures', 'variationAxes', 'status'];

/** User-owned fields — only written by user edit actions via decisions.*.userOverride */
export const USER_OWNED_FIELDS = ['title', 'documentId', 'weight', 'weightName', 'style', 'subfamily'];
```

---

## Review Amendments

### Resolved
- **C5:** `assetRef: string|null` → `assetRefs: Object.<string, string>` (per-format map for idempotent retry)
- **C9:** Replaced `fontKit: Object|null` with `parsedMetadata: FontMetadataSnapshot|null`. Raw fontkit object is NOT retained in plan state. Worker extracts needed fields and returns a plain object. Re-parse from `File` handle in Phase 2 only if needed.
- **M2:** Added `PATCHING_TYPEFACE` to `EXECUTION_STATUS` enum
- **M3:** Added `source` field to `SubfamilyDecision`
- **M4:** Added `WeightNameDecision` to `FontDecisions`
- **M5:** Removed redundant `action` field from `ExistingDocumentDecision`. `executeUploadPlan` derives action: if `userChoice` is set, use it; else derive from `recommendation` (use-exact/use-candidate → update, ambiguous/create → create).
- **M18:** Added `docId` param to `buildUploadPlan`
- **M19:** Added `SubfamilyEntry` typedef
- **M20:** Added `PROCESSING_OWNED_FIELDS` and `USER_OWNED_FIELDS` const arrays
- **M25:** Added `resolveExistingFont` function signature

### Open for implementation
- **C6:** `SET_FONT_DOCUMENT_ID` must validate ID is font-appropriate (e.g., starts with expected prefix or passes a regex). `executeUploadPlan` Phase 2 must verify `_type === 'font'` before `createOrReplace`.
- Event types (`ProcessingProgressEvent`, `ExecutionProgressEvent`) use optional fields rather than proper discriminated unions. During TS migration, convert to tagged union types with per-variant required fields.
- `DocumentIdDecision` should gain an `alternatives: string[]` field for ID suggestions when the derived ID conflicts. Deferred to implementation.
- Consider branded types (`TempId`, `SanityDocumentId`, `SubfamilyKey`) during TS migration to prevent cross-map key confusion.
