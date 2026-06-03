# Font Upload Testing Strategy

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md), [plan-types.md](./plan-types.md)

---

## Testing Stack

- **Test runner:** Vitest (already configured)
- **Component testing:** Vitest + `@testing-library/react` (needs adding as devDep)
- **Mocking:** Vitest built-in mocks for Sanity client, fontkit
- **Fixtures:** Real font files (small subset) for integration tests, mock fontkit objects for unit tests

---

## 1. Unit Tests — Orchestrators

### `buildUploadPlan.test.js` (new)

| Case | Description | Asserts |
|---|---|---|
| Happy path | 4 files (2 TTF + 2 WOFF2) → plan with 2 font entries | `plan.fonts` has 2 entries, each with 2 files |
| File grouping | TTF + WOFF2 of same font → merged into one entry | Single `FontPlanEntry` with `files.length === 2` |
| VF detection | Font with `variationAxes` having `min !== max` → `variableFont: true` | `entry.variableFont === true` |
| VF degenerate axes | Font with axes where `min === max` → `variableFont: false` | Not classified as VF |
| Subfamily assignment | "Halyard Display Bold" with title "Halyard" → subfamily "Display" | `entry.subfamily === 'Display'` |
| VF subfamily cleared (opsz) | VF WITH optical-size axis → subfamily cleared | `entry.subfamily === ''` |
| VF subfamily preserved (no opsz) | VF WITHOUT optical-size axis, but with detected subfamily → preserved | `entry.subfamily === 'Display'` |
| VF subfamily empty (no opsz, no sub) | VF WITHOUT optical-size axis, no detected subfamily → stays empty | `entry.subfamily === ''` |
| VF degenerate opsz | VF with `opsz.min === opsz.max` + detected subfamily → preserved (degenerate opsz ignored) | `entry.subfamily` retained |
| VF slnt + ital coexistence | VF with both `slnt` and `ital` axes → `slnt` takes priority for CSS | CSS output uses `oblique` range, not `italic` |
| preserveFileNames on | Filename used for title/ID derivation | `entry.title` derived from filename, `decisions.title.source === 'filename'` |
| preserveFileNames off | fontkit fullName used for title derivation | `decisions.title.source === 'fontkit-fullName'` |
| preserveShortenedNames on | "Bd" stays "Bd" | Title contains "Bd", not "Bold" |
| preserveShortenedNames off | "Bd" expanded to "Bold" | Title contains "Bold" |
| Processing progress | 4 files → onProgress called 4 times with correct counts | `progress.completed` increments |
| Processing error | Corrupt file → error entry, progress continues | `entry.status === 'error'`, other entries still processed |
| Empty files array | 0 files → plan with empty fonts map | `Object.keys(plan.fonts).length === 0` |
| Plan version | Plan always has `version: 1` | `plan.version === 1` |
| tempId uniqueness | Two files resolving to same title → different tempIds | Unique keys in `plan.fonts` |

### `executeUploadPlan.test.js` (new)

| Case | Description | Asserts |
|---|---|---|
| Happy path | Plan with 2 fonts → 2 documents created | `result.created === 2`, `result.success === true` |
| Update existing | Font with `action: 'update'` → patches existing doc | `client.patch` called, `result.updated === 1` |
| Create new | Font with `action: 'create'` → creates new doc | `client.createOrReplace` called, `result.created === 1` |
| Skip error fonts | Font with `status: 'error'` → skipped | `result.skipped === 1`, no upload attempted |
| Asset upload failure | `client.assets.upload` throws → font marked failed | `result.failed === 1`, `failedFonts[0].failedAt === 'asset-upload'` |
| CSS generation failure | CSS gen throws → font marked failed | `failedFonts[0].failedAt === 'css-generation'` |
| Idempotent retry | Font with cached `assetRefs` (per-format map) → asset upload skipped for cached formats | `client.assets.upload` not called for formats with existing refs |
| Typeface patch | All fonts done → typeface document patched | `client.patch(docId).set()` called with dot-path keys |
| Typeface patch preserves siblings | Patch uses `'styles.fonts'` not `styles: { fonts }` | Patch object has dot-path keys |
| Partial failure + patch | 1 of 3 fails → typeface patch includes 2 refs | `fontRefs.length === 2` |
| Concurrency control | 10 fonts → max 3 concurrent uploads | Assert upload concurrency via mock timing |
| Metadata generation failure | metadata gen throws → font marked failed | `failedFonts[0].failedAt === 'metadata-generation'` |
| Typeface patch failure | All fonts succeed but `client.patch().commit()` throws | `result.typefacePatchError` is set, `result.success === false` |
| 429 exponential backoff | `client.assets.upload` returns 429 → retries with backoff+jitter, max 3 attempts | Timing assertions on retry intervals |
| Progress callbacks | Each step fires correct event type | `onProgress` called with `font-upload-start`, `file-uploaded`, etc. |

---

## 2. Unit Tests — Reducer

### `planReducer.test.js` (new)

Test every action type with happy path, edge case, and invalid state:

| Action | Happy Path | Edge Case |
|---|---|---|
| `ADD_PROCESSED_FONT` | Adds new font entry to `fonts` map | Does NOT overwrite existing entry with same tempId (processing vs. user edit isolation) |
| `SET_PROCESSING_ERROR` | Sets font `status: 'error'`, `error: message` | Font that doesn't exist → no-op |
| `SET_FONT_TITLE` | Updates `title` and sets `decisions.title.userOverride` | Null/empty string → validation error flag |
| `SET_FONT_DOCUMENT_ID` | Updates `documentId` and `decisions.documentId.userOverride` | ID collision with another font in batch → warning flag |
| `SET_FONT_WEIGHT` | Updates `weight` and `decisions.weight.userOverride` | Value outside 1-1000 → clamped |
| `SET_FONT_STYLE` | Updates `style` and `decisions.style.userOverride` | — |
| `SET_FONT_SUBFAMILY` | Updates `subfamily`, `decisions.subfamily.userOverride`, and `subfamilyGroups` | Moving font between groups updates both source and target |
| `SET_FONT_ACTION` | Updates `decisions.existingDocument.action` and `userChoice` | Switching from update to create clears `selectedCandidate` |
| `SET_FONT_CANDIDATE` | Sets `selectedCandidate` on existingDocument | — |
| `MOVE_FONT_TO_SUBFAMILY` | Removes from old group, adds to new group | Creating a new subfamily group that doesn't exist yet |
| `ACCEPT_ALL_SUGGESTIONS` | Sets all `userOverride` to null across all fonts | Scoped variant: only affects filtered/visible fonts |
| `RESET_FONT_TO_SUGGESTIONS` | Resets one font's overrides to null | — |
| `SET_PHASE` | Updates `plan.phase` | Invalid phase transition → no-op |
| `SET_SETTINGS` | Updates `settings` | — |

### Concurrency isolation tests

| Scenario | Description | Asserts |
|---|---|---|
| Processing + user edit interleave | Dispatch `ADD_PROCESSED_FONT` for font B, then `SET_FONT_TITLE` for font A in same tick | Font A's title change preserved, font B added |
| Rapid user edits | 10 `SET_FONT_TITLE` dispatches for same font | Final state has last title |
| Processing overwrite guard | `ADD_PROCESSED_FONT` for font A when A already exists (user edited it) | Processing data merged, user overrides preserved |

---

## 3. Unit Tests — Existing Utilities (extend existing)

### `processFontFiles.test.js` (extend)

| Case | Description |
|---|---|
| Decision audit trail populated | Each font has `decisions.title`, `.weight`, `.style`, `.subfamily` with correct sources |
| Title alternatives | `decisions.title.alternatives` contains values from name IDs 1, 4, 6, 16, 17, and filename |
| Weight audit | `decisions.weight.matchedKeyword` is set when keyword match used |
| Webfont metadata patching | WOFF2 with missing name records → patched from companion TTF |
| Webfont metadata — no companion | WOFF2 with missing records and no TTF → graceful fallback |

### `updateTypefaceDocument.test.js` (extend)

| Case | Description |
|---|---|
| Dot-path patch keys | Patch uses `'styles.fonts'`, `'styles.variableFont'`, `'styles.subfamilies'` |
| Preserves collections/pairs | `styles.collections`, `styles.pairs`, `styles.free`, `styles.displayStyles` unchanged |
| preferredStyle sticky | Non-empty preferredStyle → not overwritten |
| preferredStyle empty → set | Empty preferredStyle + candidate → set |

### `sanitizeForSanityId.test.js` (extend)

| Case | Description |
|---|---|
| Deterministic for long inputs | Same input > 128 chars → same output (replace Math.random with hash) |
| Idempotent | `sanitizeForSanityId(sanitizeForSanityId(x)) === sanitizeForSanityId(x)` |

---

## 4. Unit Tests — resolveExistingFont

### `resolveExistingFont.test.js` (new — from port plan + extensions)

| Case | Description | Expected |
|---|---|---|
| Exact `_id` match | Font doc exists with matching `_id` | `{ recommendation: 'use-exact', exact: doc }` |
| Exact `slug.current` match | No ID match, slug matches | `{ recommendation: 'use-exact', exact: doc }` |
| Single content match | No ID/slug, one doc matches by typefaceName + weightName + style + subfamily | `{ recommendation: 'use-candidate', candidates: [doc] }` |
| Multiple content matches | Two docs match on content | `{ recommendation: 'ambiguous', candidates: [doc1, doc2] }` |
| No match | Nothing matches | `{ recommendation: 'create' }` |
| Null/empty subfamily equivalence | `null`, `''`, and `'Regular'` treated as equivalent | Match found |
| Case-insensitive matching | Different casing on style/weightName | Match found |
| variableFont undefined = false | Existing doc has no `variableFont` field, query uses `false` | Match found |
| Network error | Sanity fetch throws | Graceful fallback to `'create'`, error logged |

---

## 5. Component Tests

### `FontReviewCard.test.jsx` (new)

| Case | Description |
|---|---|
| Renders collapsed | Shows title, weight badge, style badge, subfamily badge, action badge |
| Renders expanded | Shows all editable fields |
| Title edit | Typing in title input dispatches `SET_FONT_TITLE` |
| Weight edit | Changing weight dispatches `SET_FONT_WEIGHT` |
| Style toggle | Switching style dispatches `SET_FONT_STYLE` |
| Subfamily change | Selecting subfamily dispatches `SET_FONT_SUBFAMILY` |
| Error state | Font with `status: 'error'` renders error card with message |
| Decision source display | Weight source "OS/2 table: 700" shown as hint |
| Reset to suggestion | Click "Reset" → dispatches `RESET_FONT_TO_SUGGESTIONS` |

### `ExistingDocumentResolver.test.jsx` (new)

| Case | Description |
|---|---|
| use-exact | Shows "Found existing: <title>. Will update." |
| use-candidate | Shows candidate with "Update this?" option |
| ambiguous | Shows multiple candidates as radio list |
| create | Shows "No match found. Will create new." |
| Switch to create | User clicks "Create new instead" → dispatches `SET_FONT_ACTION` |
| Switch to update | User selects candidate → dispatches `SET_FONT_CANDIDATE` |

### `SubfamilyOrganizer.test.jsx` (new)

| Case | Description |
|---|---|
| Renders groups | Each subfamily shown with its fonts listed |
| Reassign font | Changing dropdown dispatches `MOVE_FONT_TO_SUBFAMILY` |
| Empty group | Subfamily with no fonts shows "No fonts" state |
| Add new group | — (if supported in v1) |

### `BulkActions.test.jsx` (new)

| Case | Description |
|---|---|
| Expand all | Dispatches expand for all cards |
| Collapse all | Dispatches collapse for all cards |
| Accept all | Dispatches `ACCEPT_ALL_SUGGESTIONS` |
| Filter by subfamily | Only matching cards visible |
| Filter by action type | Only create/update cards visible |
| Search | Cards filtered by title match |
| Filter + accept all | Accept only applies to visible/filtered fonts |

### `UploadModal.test.jsx` (new)

| Case | Description |
|---|---|
| Opens on button click | Modal renders with Step 1 |
| Step 1 → Step 2 | Click "Process Files" with files selected → processing starts |
| Step 2 → Step 4 | Click "Upload" after review → execution starts |
| Validation failure | Duplicate IDs → error shown, cannot proceed |
| Confirmation dialog | Summary shown before upload: "Create X, update Y" |
| Close during idle | Modal closes normally |
| Close during upload | Warning dialog shown |

---

## 6. Integration Tests

### `upload-pipeline.test.js` (new)

End-to-end tests with mocked Sanity client and real (small) font files:

| Case | Description |
|---|---|
| Full pipeline | Select files → buildUploadPlan → edit title → executeUploadPlan → verify result |
| Partial failure + retry | 1 of 3 fails → retry failed → all succeed |
| preserveFileNames e2e | Filename-derived titles and IDs flow through to document creation |
| Update existing font | Plan finds existing doc → execute patches it |
| Subfamily organization | 6 fonts in 2 subfamilies → typeface patch has correct subfamily structure |

---

## 7. Contract Tests

### `plan-contract.test.js` (new)

Validate the plan object shape at the boundary between producer and consumer:

| Case | Description |
|---|---|
| buildUploadPlan output shape | Returned plan matches PlanObject typedef (required fields present, correct types) |
| executeUploadPlan input validation | Missing required fields → descriptive error |
| ExecutionResult shape | Returned result has all required fields |
| Font entry invariants | Every `subfamilyGroups.fontIds` entry exists in `plan.fonts` |
| Referential integrity | Every font's `subfamily` has a corresponding `subfamilyGroups` key |

---

## 8. Performance Benchmarks (optional, CI-gated)

| Benchmark | Target |
|---|---|
| buildUploadPlan with 100 mock fonts | < 5 seconds |
| Reducer dispatch cycle (100 fonts, single edit) | < 16ms (one frame) |
| Initial render of 100 FontReviewCards (collapsed) | < 500ms |
| Expand all (100 cards) | < 1 second |

---

## Test Fixtures

Create `src/tests/fixtures/`:
- `mock-fontkit-regular.js` — Mock fontkit object for a regular weight font
- `mock-fontkit-bold-italic.js` — Mock fontkit object for bold italic
- `mock-fontkit-variable-wght-ital.js` — VF with wght + ital axes (real variation ranges)
- `mock-fontkit-variable-opsz.js` — VF with opsz axis (for subfamily clearing tests)
- `mock-fontkit-variable-slnt-ital.js` — VF with both slnt and ital axes (priority test)
- `mock-fontkit-variable-degenerate.js` — VF with degenerate axes (min === max)
- `mock-fontkit-variable-no-opsz-with-subfamily.js` — VF without opsz but with detected subfamily
- `mock-sanity-client.js` — Mock Sanity client with configurable fetch/patch/create responses
- `mock-plan.js` — Factory function to create valid UploadPlan objects for testing
- `small-test.ttf` — Minimal valid TTF file for integration tests (can use a freely licensed font)
- `small-test.woff2` — Minimal WOFF2 with stripped name records (for no-companion fallback test)

---

## 9. Execution Reducer Tests (panel review addition)

### `executionReducer.test.js` (new)

| Case | Description | Asserts |
|---|---|---|
| SET_EXECUTION_STATUS idle→uploading | Valid transition | `status === 'uploading'` |
| SET_EXECUTION_STATUS uploading→patching-typeface | Valid transition | `status === 'patching-typeface'` |
| SET_EXECUTION_STATUS uploading→complete | Valid transition | `status === 'complete'` |
| SET_EXECUTION_STATUS uploading→error | Valid transition | `status === 'error'` |
| SET_FONT_EXECUTION_PROGRESS | Update per-font progress | `progress[tempId]` merged correctly |
| SET_FONT_EXECUTION_PROGRESS assetRefs merge | Cached asset refs accumulate across formats | `progress[tempId].assetRefs` has both `ttf` and `woff2` keys |
| SET_EXECUTION_ERROR | Sets global error | `error` set, `status === 'error'` |

---

## 10. Additional Test Gaps (panel review additions)

Tests added to fill coverage gaps identified by the panel:

| Location | Case | Description |
|---|---|---|
| `resolveExistingFont.test.js` | lookupFailed flag | Network error sets `lookupFailed: true` on decision |
| `resolveExistingFont.test.js` | VF title suffix matching | "Halyard Bold VF" matches existing "Halyard Bold" |
| `resolveExistingFont.test.js` | Truncated result set | >200 results logged as warning, matching proceeds on truncated set |
| `resolveWeight.test.js` (new) | ExtraBlack → 950 | Non-standard weight boundary |
| `resolveWeight.test.js` | Non-English: mager → 300, halbfett → 600, extrafett → 800 | German weight names |
| `resolveWeight.test.js` | W1-W9 notation | "HelveticaNeueW07" → 700 |
| `planReducer.test.js` | SET_SETTINGS guard during processing | Dispatch during `processing` phase → no-op |
| `planReducer.test.js` | SET_FONT_TITLE auto-derives documentId | Title change updates documentId unless documentId has own override |
| `planReducer.test.js` | CREATE_SUBFAMILY_GROUP | Adds empty group |
| `planReducer.test.js` | REMOVE_SUBFAMILY_GROUP guard | Blocked when fonts remain |
| `planReducer.test.js` | REMOVE_FONT | Deletes from fonts map and subfamily group |
| `planReducer.test.js` | ADD_PROCESSED_FONT merge: field-level | Assert processing-owned fields updated, user overrides preserved |
| `FontReviewCard.test.jsx` | VF weight outside axis range warning | Weight 1000 on VF with wght 100-900 → warning shown |
| `UploadModal.test.jsx` | beforeunload registration | Upload start registers handler, completion deregisters |
| `upload-pipeline.test.js` | Retry re-uses cached assetRefs | Successful retry does NOT re-upload already-cached assets |
