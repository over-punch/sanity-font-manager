# Accessibility & Interaction Specification

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md), [reducer-action-catalog.md](./reducer-action-catalog.md)

---

## Scope

This spec covers keyboard interaction, focus management, ARIA roles/properties, and screen reader announcements for the upload modal. Sanity UI components provide baseline accessibility — this spec documents the additional requirements specific to this modal's interaction patterns.

---

## 1. Modal Dialog

### ARIA

| Attribute | Value | Notes |
|---|---|---|
| `role` | `dialog` | Sanity UI `Dialog` provides this |
| `aria-modal` | `true` | Sanity UI `Dialog` provides this |
| `aria-labelledby` | ID of the step title heading | Must update on step transitions |

### Focus trap

- Tab and Shift+Tab cycle within the modal (Sanity UI `Dialog` handles this)
- During Phase 2 (execution): Escape key is intercepted and suppressed
- During other phases: Escape closes the modal (with confirmation if plan has data)

### Focus on open

Focus moves to the first interactive element in Step 1 (the price input).

---

## 2. Step Navigation

### Structure

The modal has 3 steps (merged Step 2+3):
1. Settings & Files
2. Processing & Review
3. Upload Execution

### Step indicator

```html
<nav aria-label="Upload steps">
  <ol>
    <li aria-current="step">1. Settings</li>  <!-- or aria-current removed when not active -->
    <li>2. Review</li>
    <li>3. Upload</li>
  </ol>
</nav>
```

### Focus on step transition

| Transition | Focus target |
|---|---|
| Step 1 → Step 2 | The processing status region (or first review card once available) |
| Step 2 → Step 3 | The "Upload to Sanity" button (after confirmation dialog) |
| Step 3 complete | The summary heading |

---

## 3. Step 1: Settings & File Selection

### Drag-and-drop zone

The drag-and-drop zone is **not** keyboard accessible. A visible "Browse files" button provides the keyboard-accessible alternative (opens native file picker).

```html
<div role="region" aria-label="File upload area">
  <!-- Drop zone (visual only, no keyboard interaction) -->
  <button>Browse files</button>  <!-- Keyboard accessible -->
  <input type="file" hidden />   <!-- Triggered by button click -->
</div>
```

### File list

Each file row has a remove button with a unique accessible name:

```html
<button aria-label="Remove MyFont-Bold.ttf">
  <TrashIcon />
</button>
```

### Settings toggles

Sanity UI `Switch` provides baseline accessibility. Each switch must have a visible `<Label>` associated via `htmlFor` or wrapping.

---

## 4. Step 2+3: Processing & Review

### Processing status region

```html
<div role="status" aria-live="polite" aria-label="Processing progress">
  Processing 12 of 48 files...
</div>
```

Updates on each file completion. Uses `aria-live="polite"` so announcements don't interrupt user editing.

### Card list structure

```html
<section aria-label="Font review">
  <h2>Review Fonts</h2>
  <!-- Bulk actions bar -->
  <!-- Card list -->
  <div role="list" aria-label="Font cards">
    <!-- Individual cards -->
  </div>
</section>
```

### Individual font review card

Each card uses the disclosure pattern:

```html
<div role="listitem">
  <h3>
    <button
      aria-expanded="false"
      aria-controls="font-card-content-{tempId}"
      id="font-card-header-{tempId}"
    >
      <span>Halyard Display Bold</span>
      <span aria-label="Weight 700">700</span>
      <span>Regular</span>
      <span aria-label="Action: Create new">Create</span>
    </button>
  </h3>
  <div
    id="font-card-content-{tempId}"
    role="region"
    aria-labelledby="font-card-header-{tempId}"
    hidden  <!-- toggled by aria-expanded -->
  >
    <!-- Editable fields -->
  </div>
</div>
```

### Card keyboard navigation

With potentially 50+ cards, sequential Tab navigation is unusable. Implement roving tabindex on card headers:

| Key | Action |
|---|---|
| Tab | Move to next interactive element (enters card content if expanded, or next card header) |
| Arrow Down | Move to next card header |
| Arrow Up | Move to previous card header |
| Home | Move to first card header |
| End | Move to last card header |
| Enter / Space | Toggle card expanded/collapsed |

When a card is collapsed, Tab skips its content entirely.

### Editable fields within expanded cards

Each field must have an associated label:

```html
<label for="title-{tempId}">Font title</label>
<input id="title-{tempId}" type="text" value="Halyard Display Bold" />
<span id="title-hint-{tempId}" class="visually-hidden">
  Derived from: fontkit fullName "HalyardDisplay-Bold"
</span>
<input aria-describedby="title-hint-{tempId}" />
```

### Source/provenance hints

Decision source information (e.g., "OS/2 table: 700") should be accessible via `aria-describedby`, not just tooltip:

```html
<label for="weight-{tempId}">Weight</label>
<input
  id="weight-{tempId}"
  type="number"
  value="700"
  aria-describedby="weight-source-{tempId}"
/>
<span id="weight-source-{tempId}" class="visually-hidden">
  Source: OS/2 usWeightClass
</span>
```

### Existing document resolution

Radio group pattern:

```html
<fieldset>
  <legend>Existing document action</legend>
  <div role="radiogroup" aria-labelledby="doc-action-legend-{tempId}">
    <label>
      <input type="radio" name="doc-action-{tempId}" value="create" checked />
      Create new document
    </label>
    <label>
      <input type="radio" name="doc-action-{tempId}" value="update" />
      Update existing: halyard-display-bold
    </label>
  </div>
</fieldset>
```

For ambiguous matches (multiple candidates), each candidate is a radio option with descriptive text.

### Error state on cards

```html
<div role="listitem">
  <h3>
    <button aria-expanded="false">
      <span aria-label="Error">⚠</span>
      <span>MyFont-BoldItalic.ttf</span>
    </button>
  </h3>
  <div role="alert">
    Could not parse font: Invalid sfnt version
  </div>
</div>
```

### Validation errors on fields

```html
<input
  id="docid-{tempId}"
  aria-invalid="true"
  aria-errormessage="docid-error-{tempId}"
/>
<span id="docid-error-{tempId}" role="alert">
  Document ID conflicts with another font in this batch
</span>
```

---

## 5. Bulk Actions

### Announcements

Each bulk action must announce its result via a live region:

```html
<div aria-live="polite" class="visually-hidden" id="bulk-action-status">
  <!-- Dynamically updated -->
</div>
```

| Action | Announcement text |
|---|---|
| Expand All | "All {N} cards expanded" |
| Collapse All | "All {N} cards collapsed" |
| Accept All | "Suggestions accepted for {N} fonts" |
| Filter applied | "{N} of {total} fonts shown" |
| Search | "{N} fonts matching '{query}'" |
| Clear filter | "Showing all {total} fonts" |

### Filter/search during processing

Filters apply to cards as they appear. A newly processed card that matches the active filter appears; one that doesn't match is hidden but counted:

Announcement: "32 of 48 fonts processed. 18 matching current filter."

---

## 6. Subfamily Organization

### Dropdown labels

Each reassignment dropdown must include the font name for context:

```html
<label for="subfamily-{tempId}">
  Subfamily for Halyard Display Bold
</label>
<select id="subfamily-{tempId}">
  <option>Display</option>
  <option>Text</option>
</select>
```

---

## 7. Step 3: Upload Execution

### Progress indicators

Each font row during upload has a semantic progress indicator:

```html
<div role="listitem" aria-label="Halyard Display Bold">
  <div
    role="progressbar"
    aria-valuenow="2"
    aria-valuemin="0"
    aria-valuemax="4"
    aria-label="Uploading Halyard Display Bold: 2 of 4 files"
  >
    <!-- Visual progress bar -->
  </div>
  <span aria-live="off">Uploading WOFF2...</span>
</div>
```

Status icons need text alternatives:

| Icon | `aria-label` |
|---|---|
| Grey circle | "Queued" |
| Blue spinner | "In progress" |
| Green check | "Complete" |
| Red X | "Failed" |

### Global progress

```html
<div role="status" aria-live="polite">
  Uploading 5 of 24 fonts... Elapsed: 1m 23s
</div>
```

### Do-not-close warning

```html
<div role="alert">
  Do not close or reload this tab. Upload in progress.
</div>
```

Escape key suppressed during this phase. Modal close button disabled with `aria-disabled="true"`.

---

## 8. Post-Completion Summary

### Focus

Focus moves to the summary heading on completion:

```html
<h2 tabindex="-1" id="upload-summary">Upload Complete</h2>
<!-- Focus programmatically set to this element -->
```

### Announcement

```html
<div role="status" aria-live="assertive">
  Upload complete. 22 fonts created, 2 updated, 0 failed.
</div>
```

---

## 9. Tooltips

Sanity UI `Tooltip` shows on hover. For keyboard accessibility:
- Tooltip trigger must be focusable (button or element with `tabindex="0"`)
- Tooltip content appears on focus as well as hover
- Trigger has `aria-describedby` pointing to the tooltip content ID
- Tooltip dismisses on Escape

---

## Screen Reader Announcement Inventory

| Event | Live region | Politeness | Text |
|---|---|---|---|
| Step transition | Step indicator | `assertive` | "Step {N}: {name}" |
| Font processing complete | Processing status | `polite` | "Processing {N} of {total}..." |
| Font processing error | Processing status | `polite` | "{filename} failed to process" |
| All processing complete | Processing status | `assertive` | "All {N} files processed. {errors} errors." |
| Card expanded | None (implicit via `aria-expanded`) | — | — |
| Bulk action result | Bulk action status | `polite` | See bulk actions table above |
| Validation error | Field error | `assertive` | Error message text |
| Upload progress | Upload status | `polite` | "Uploading {N} of {total}..." |
| Upload complete | Summary | `assertive` | "Upload complete. {created} created, {updated} updated, {failed} failed." |
| Upload error | Upload status | `assertive` | "{font title} failed: {error}" |

---

## Review Amendments (panel review 2026-05-29)

### Critical corrections
- **M11:** Escape during upload must NOT be fully suppressed — add a "Stop Upload" button (visible, focusable, keyboard-accessible) that gracefully stops after the current font completes. Escape triggers the stop action. This resolves the WCAG 2.1.2 (No Keyboard Trap) violation.
- **M26:** Disclosure pattern: move `<button>` out of `<h3>`. Use `aria-labelledby` to associate heading text as button's accessible name. Current button-inside-heading pattern causes heading role to subsume button in some screen readers.
- The `<fieldset>` + `role="radiogroup"` in existing document resolution is redundant. Use `<fieldset>` + `<legend>` only — remove the inner `role="radiogroup"` div. Add `id` to `<legend>` if `aria-labelledby` is needed elsewhere.
- The editable fields example has a structural error (two `<input>` elements). Should be one `<input>` with both `id` and `aria-describedby` attributes.
- Error cards: `role="alert"` inside a `hidden` (collapsed) card will not be announced. Move error announcement to a separate live region outside the card, or keep error cards expanded by default.

### Focus management fixes
- Step 1→2 transition: focus target should be the processing status `<div>` which needs `tabindex="-1"` to be programmatically focusable.
- Step 2→3 transition: the "Upload to Sanity" button will have unmounted. Focus the first element in the Step 3 execution view (the global progress heading).
- Post-completion: use `useEffect` to set focus after `UploadSummary` mounts, not in the same tick as the state change.
- Modal close (non-upload): save a ref to the trigger element before opening and restore focus on close (standard ARIA dialog pattern).
- Validation failure: move focus to the first error card (not just scroll), and announce a summary: "{N} validation errors found."
- Roving tabindex: first card header gets `tabindex="0"` on initial render. When a focused card is removed by filter, move `tabindex="0"` to the nearest visible card.

### Announcement fixes
- Step transitions need a dedicated `aria-live="assertive"` live region (the step indicator `<nav>` has no `aria-live`). Add a visually-hidden div.
- "All processing complete" announcement: use a separate `role="alert"` element injected on completion, not the same `aria-live="polite"` region used for per-file progress. Politeness cannot be switched at runtime.
- Bulk action live region updates should be debounced (300ms) when driven by search/filter keystrokes.
- `role="status"` already implies `aria-live="polite"` — remove explicit `aria-live="polite"` to avoid double-announcement risk.
- Upload complete: use `role="alert"` for the summary announcement, not `role="status"` with `aria-live="assertive"` (conflicting implicit vs explicit politeness).
- Per-font "Reset to suggestion" buttons need font name in accessible name: "Reset Halyard Display Bold to suggestion".
- Elapsed time counter must be outside the `aria-live` region to prevent per-second announcements.

### Other
- `<nav>` around step indicator is semantically wrong (implies interactive navigation, but steps are forward-only status indicators). Use `<div role="group" aria-label="Upload steps">` instead.
- `aria-current="step"` has inconsistent AT support. Add visible text "(current)" as fallback.
- `SubfamilyOrganizer` section needs keyboard interaction spec: collapse/expand trigger, focus sequence for add/remove buttons.
- `Autocomplete` for manual document linking needs combobox pattern spec or explicit note that Sanity UI's `Autocomplete` provides baseline a11y.
- Tooltip Escape must `stopPropagation` to prevent the modal close handler from also firing.
- Arrow keys in roving tabindex only active when focus is on a card header element. When focus is inside an expanded card's form controls, arrow keys behave normally for that input type.
