# Reducer Action Catalog

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [plan-types.md](./plan-types.md), [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md)

Complete enumeration of all `useReducer` action types with their payloads and state transitions.

> **Terminology note (panel review):** "Phase" = technical execution phase (1=plan, 2=execute). "Step" = modal UI step (1-3). `plan.phase` = state machine enum field. These are three distinct concepts.

---

## Design Principles

1. **Two separate reducers.** The plan reducer manages `UploadPlan`. Execution progress is managed separately (either a second reducer or `useRef`) to prevent Phase 2 progress ticks from re-rendering plan/review UI.

2. **Processing-owned vs. user-owned write domains.** Processing actions (`ADD_PROCESSED_FONT`, `SET_PROCESSING_ERROR`) only write to processing-owned fields. User actions (`SET_FONT_TITLE`, etc.) only write to `decisions.*.userOverride`. The reducer enforces this boundary.

3. **Each action is the minimal mutation.** No action touches fields outside its documented scope.

---

## Plan Reducer Actions

### Phase / Settings

#### `SET_PHASE`

Transitions the modal phase.

```js
/** @type {{ type: 'SET_PHASE', phase: PlanPhase }} */
// Valid transitions:
//   idle → processing
//   processing → reviewing
//   reviewing → ready
//   ready → executing
//   executing → complete
//   executing → error
//   any → idle (reset)
```

**State change:** `plan.phase = action.phase`
**Guard:** Invalid transitions are no-ops (logged as warnings).

#### `SET_SETTINGS`

Updates global upload settings.

```js
/** @type {{ type: 'SET_SETTINGS', settings: Partial<PlanSettings> }} */
```

**State change:** `plan.settings = { ...plan.settings, ...action.settings }`
**Guard:** Only allowed when `plan.phase` is `idle`. Once processing starts, settings are locked and shown as read-only in the review step.

> **Panel review correction:** Was `idle` or `reviewing`. Changed to `idle` only because changing settings (e.g., `preserveFileNames`) during review would invalidate already-processed font decisions with no reconciliation mechanism.

---

### Processing (Phase 1)

These are dispatched by the `buildUploadPlan` orchestrator via `onProgress` callbacks.

#### `ADD_PROCESSED_FONT`

Adds a newly processed font to the plan. Does NOT overwrite an existing entry with the same `tempId` if the user has already edited it.

```js
/**
 * @type {{
 *   type: 'ADD_PROCESSED_FONT',
 *   tempId: string,
 *   fontEntry: FontPlanEntry
 * }}
 */
```

**State change:**
- If `plan.fonts[tempId]` does not exist: `plan.fonts[tempId] = action.fontEntry`
- If `plan.fonts[tempId]` already exists (user edited it during processing): merge only processing-owned fields (fontKit, glyphCount, opentypeFeatures, variationAxes, status), preserve all `decisions.*.userOverride` values
- Updates `plan.subfamilyGroups` to include this font in the appropriate group
- Updates `plan.processingProgress.completed++`

#### `SET_PROCESSING_ERROR`

Marks a font as failed during processing.

```js
/**
 * @type {{
 *   type: 'SET_PROCESSING_ERROR',
 *   tempId: string,
 *   error: string
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].status = 'error'`
- `plan.fonts[tempId].error = action.error`
- `plan.processingProgress.failed++`

#### `SET_PROCESSING_PROGRESS`

Updates the overall processing progress counter.

```js
/**
 * @type {{
 *   type: 'SET_PROCESSING_PROGRESS',
 *   progress: PlanProcessingProgress
 * }}
 */
```

**State change:** `plan.processingProgress = action.progress`

---

### User Edits (Review Step)

These are dispatched by UI components when the user modifies font metadata.

#### `SET_FONT_TITLE`

```js
/**
 * @type {{
 *   type: 'SET_FONT_TITLE',
 *   tempId: string,
 *   title: string
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].title = action.title`
- `plan.fonts[tempId].decisions.title.userOverride = action.title`
- `plan.fonts[tempId].decisions.title.source = 'user-override'`
- Auto-derives `documentId` from new title (unless documentId has its own userOverride)

**Note:** Dispatch on blur, not on every keystroke. Use local component state for typing.

#### `SET_FONT_DOCUMENT_ID`

```js
/**
 * @type {{
 *   type: 'SET_FONT_DOCUMENT_ID',
 *   tempId: string,
 *   documentId: string
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].documentId = sanitizeForSanityId(action.documentId)`
- `plan.fonts[tempId].decisions.documentId.userOverride = action.documentId`

**Validation:** If new ID collides with another font in the batch, set a `_idConflict: true` flag on both entries.

#### `SET_FONT_WEIGHT`

```js
/**
 * @type {{
 *   type: 'SET_FONT_WEIGHT',
 *   tempId: string,
 *   weight: number
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].weight = clamp(action.weight, 1, 1000)`
- `plan.fonts[tempId].decisions.weight.userOverride = action.weight`

#### `SET_FONT_WEIGHT_NAME`

```js
/**
 * @type {{
 *   type: 'SET_FONT_WEIGHT_NAME',
 *   tempId: string,
 *   weightName: string
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].weightName = action.weightName`
- `plan.fonts[tempId].decisions.weightName.userOverride = action.weightName`

> **Panel review fix:** Was missing the `decisions` audit trail write. Without it, `ACCEPT_ALL_SUGGESTIONS` and `RESET_FONT_TO_SUGGESTIONS` cannot revert weightName changes.

#### `SET_FONT_STYLE`

```js
/**
 * @type {{
 *   type: 'SET_FONT_STYLE',
 *   tempId: string,
 *   style: 'Regular' | 'Italic'
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].style = action.style`
- `plan.fonts[tempId].decisions.style.userOverride = action.style`

#### `SET_FONT_SUBFAMILY`

```js
/**
 * @type {{
 *   type: 'SET_FONT_SUBFAMILY',
 *   tempId: string,
 *   subfamily: string
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].subfamily = action.subfamily`
- `plan.fonts[tempId].decisions.subfamily.userOverride = action.subfamily`
- Removes font from old subfamily group in `plan.subfamilyGroups`
- Adds font to new subfamily group (creates group if it doesn't exist)

#### `SET_FONT_ACTION`

Sets create vs. update decision for existing document resolution.

```js
/**
 * @type {{
 *   type: 'SET_FONT_ACTION',
 *   tempId: string,
 *   decision: 'create' | 'update'
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].decisions.existingDocument.userChoice = action.decision`
- If switching to `'create'`: clears `selectedCandidate`

#### `SET_FONT_CANDIDATE`

Selects which existing document to update.

```js
/**
 * @type {{
 *   type: 'SET_FONT_CANDIDATE',
 *   tempId: string,
 *   candidate: ExistingDocMatch
 * }}
 */
```

**State change:**
- `plan.fonts[tempId].decisions.existingDocument.selectedCandidate = action.candidate`
- `plan.fonts[tempId].decisions.existingDocument.action = 'update'`
- `plan.fonts[tempId].decisions.existingDocument.userChoice = 'update'`
- `plan.fonts[tempId].documentId = action.candidate._id`

---

### Subfamily Organization

#### `MOVE_FONT_TO_SUBFAMILY`

Reassigns a font from one subfamily group to another.

```js
/**
 * @type {{
 *   type: 'MOVE_FONT_TO_SUBFAMILY',
 *   tempId: string,
 *   fromSubfamily: string,
 *   toSubfamily: string
 * }}
 */
```

**State change:**
- Removes `tempId` from `plan.subfamilyGroups[fromSubfamily].fontIds`
- Adds `tempId` to `plan.subfamilyGroups[toSubfamily].fontIds` (creates group if new)
- Updates `plan.fonts[tempId].subfamily = action.toSubfamily`
- Removes empty subfamily groups (no fontIds remaining)

#### `CREATE_SUBFAMILY_GROUP`

```js
/** @type {{ type: 'CREATE_SUBFAMILY_GROUP', title: string }} */
```

**State change:** Adds `plan.subfamilyGroups[title] = { title, fontIds: [] }`

#### `REMOVE_SUBFAMILY_GROUP`

```js
/** @type {{ type: 'REMOVE_SUBFAMILY_GROUP', title: string }} */
```

**Guard:** Only allowed if group has no fonts. If fonts remain, they must be reassigned first.
**State change:** Deletes `plan.subfamilyGroups[title]`

---

### Bulk Actions

#### `ACCEPT_ALL_SUGGESTIONS`

Resets all user overrides to null (accept system recommendations). Optionally scoped to a subset.

```js
/**
 * @type {{
 *   type: 'ACCEPT_ALL_SUGGESTIONS',
 *   scope?: string[]  // Optional array of tempIds. If omitted, applies to all fonts.
 * }}
 */
```

**State change:** For each font in scope:
- All `decisions.*.userOverride` set to `null`
- Top-level fields (`title`, `documentId`, `weight`, `style`, `subfamily`) reverted to system-detected values

#### `RESET_FONT_TO_SUGGESTIONS`

Resets a single font's overrides.

```js
/** @type {{ type: 'RESET_FONT_TO_SUGGESTIONS', tempId: string }} */
```

**State change:** Same as `ACCEPT_ALL_SUGGESTIONS` but for one font.

#### `REMOVE_FONT`

Removes a font from the plan entirely (e.g., after processing error).

```js
/** @type {{ type: 'REMOVE_FONT', tempId: string }} */
```

**State change:**
- Deletes `plan.fonts[tempId]`
- Removes from its subfamily group
- Cleans up empty subfamily groups

---

## Execution State Actions

These operate on the separate `ExecutionState` (not the plan reducer).

#### `SET_EXECUTION_STATUS`

```js
/** @type {{ type: 'SET_EXECUTION_STATUS', status: ExecutionState['status'] }} */
```

#### `SET_FONT_EXECUTION_PROGRESS`

```js
/**
 * @type {{
 *   type: 'SET_FONT_EXECUTION_PROGRESS',
 *   tempId: string,
 *   progress: Partial<FontExecutionProgress>
 * }}
 */
```

**State change:** `executionState.progress[tempId] = { ...existing, ...action.progress }`

#### `SET_EXECUTION_ERROR`

```js
/** @type {{ type: 'SET_EXECUTION_ERROR', error: string }} */
```

**State change:** `executionState.status = 'error'`, `executionState.error = action.error`

---

## Action Summary Table

| Action | Reducer | Dispatched By | Phase |
|---|---|---|---|
| `SET_PHASE` | Plan | Modal controller | Any |
| `SET_SETTINGS` | Plan | Step 1 UI | Settings |
| `ADD_PROCESSED_FONT` | Plan | buildUploadPlan callback | Processing |
| `SET_PROCESSING_ERROR` | Plan | buildUploadPlan callback | Processing |
| `SET_PROCESSING_PROGRESS` | Plan | buildUploadPlan callback | Processing |
| `SET_FONT_TITLE` | Plan | FontReviewCard | Review |
| `SET_FONT_DOCUMENT_ID` | Plan | FontReviewCard | Review |
| `SET_FONT_WEIGHT` | Plan | FontReviewCard | Review |
| `SET_FONT_WEIGHT_NAME` | Plan | FontReviewCard | Review |
| `SET_FONT_STYLE` | Plan | FontReviewCard | Review |
| `SET_FONT_SUBFAMILY` | Plan | FontReviewCard | Review |
| `SET_FONT_ACTION` | Plan | ExistingDocumentResolver | Review |
| `SET_FONT_CANDIDATE` | Plan | ExistingDocumentResolver | Review |
| `MOVE_FONT_TO_SUBFAMILY` | Plan | SubfamilyOrganizer | Review |
| `CREATE_SUBFAMILY_GROUP` | Plan | SubfamilyOrganizer | Review |
| `REMOVE_SUBFAMILY_GROUP` | Plan | SubfamilyOrganizer | Review |
| `ACCEPT_ALL_SUGGESTIONS` | Plan | BulkActions | Review |
| `RESET_FONT_TO_SUGGESTIONS` | Plan | FontReviewCard | Review |
| `REMOVE_FONT` | Plan | FontReviewCard / BulkActions | Review |
| `SET_EXECUTION_STATUS` | Execution | executeUploadPlan callback | Execute |
| `SET_FONT_EXECUTION_PROGRESS` | Execution | executeUploadPlan callback | Execute |
| `SET_EXECUTION_ERROR` | Execution | executeUploadPlan callback | Execute |

---

## Review Amendments

### Resolved
- **M4:** `SET_FONT_WEIGHT_NAME` now writes to `decisions.weightName.userOverride`
- **m11:** `SET_FONT_ACTION` payload field renamed from `action` to `decision` to avoid `action.action` naming collision
- **m12:** `SET_PROCESSING_PROGRESS` removed — progress is derived from font statuses via `ADD_PROCESSED_FONT` and `SET_PROCESSING_ERROR`. No separate wholesale overwrite needed.
- **M17:** `SET_SETTINGS` guard tightened to `idle` only (was `idle` or `reviewing`)

### Open for implementation
- **M6:** Consider `ADD_PROCESSED_FONTS_BATCH` action for processing phase. `buildUploadPlan` buffers 5-10 results and dispatches in batches to reduce re-render count from 200 to ~20-40. Individual `ADD_PROCESSED_FONT` retained for streaming UX but debounced to max 1 dispatch per 100ms.
- **M10:** Rename `ACCEPT_ALL_SUGGESTIONS` to `ACCEPT_VISIBLE_SUGGESTIONS`. Button label: "Accept Suggestions for {N} Visible Fonts". Component computes `scope` array from current filter state before dispatch.
- **C6:** `SET_FONT_DOCUMENT_ID` reducer should validate ID format (e.g., reject IDs that match known non-font document patterns). `executeUploadPlan` must verify `_type === 'font'` before `createOrReplace`.
- `SET_FONT_SUBFAMILY` and `MOVE_FONT_TO_SUBFAMILY` have overlapping semantics. Consider merging into one action or clearly documenting when each is dispatched (card dropdown vs. organizer section).
- `SET_FONT_SUBFAMILY` and `MOVE_FONT_TO_SUBFAMILY` should guard against duplicate `tempId` in `fontIds` arrays to prevent double-rendering from rapid dispatch.
