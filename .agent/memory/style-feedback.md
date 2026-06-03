# Upload Modal — Style & UX Feedback

Collected during testing. Apply in a single pass after upload testing completes.

## Step indicators (modal header)
- Active step text should be white, not blue — hard to read on the blue background

## Step 2 — Processing progress bar
- Use success green for the progress bar while processing

## Step 2 — BulkActions bar
- Add "Filter" label on top of the filter dropdown (not just beside it)
- "Expand All" button should be below search/filter row, above the sortable column headers
- Filter dropdown counts should show total font **documents**, not total files

## Step 2 — FontReviewCard source hints
- Weight Name: no source showing — ensure source hint is displayed
- Subfamily "default-empty" on Regulars: change to something like `empty — defaults to "Regular"`
- Font title: clicking a suggestion shows `nameId1 (familyName) (user override) (user override)` — duplicate "user override", fix the reducer/display logic
- Document ID: make read-only — must be unique, can't risk accidental duplicates. Add duplicate detection/error display

## Step 2 — FontReviewCard content
- Remove "File Formats" section and glyph count (already done)
- Remove "Reset to Suggestions" unless user has actually overridden something (already done)

## Step 3 — Upload execution
- Progress shows "uploading 0 of X fonts" — counter not incrementing during execution. Check onProgress dispatch in executeUploadPlan
- Move the per-font loader/status indicator to the right of the file type badge (outside the card), don't increase card width when loader finishes

## Modal behavior
- Disable click-outside-to-close entirely — processing continues in background after accidental close

## Step 3 — Upload Summary (post-completion)
- "Upload completed with issues" icon is muted/invisible — should be red/alert colored
- Stats card (X created, 1 failed) has inconsistent padding vs the failed fonts list below
- "Failed Fonts (N)" — make the number a red pill/badge beside the text, not in parentheses
- Error message below failed font should be human-readable — include the full error context from console
- Retry Failed shows "0 of 217" and ALL fonts — should only show/count the failed ones (retry filtering bug, see Step 3 counter fix)

## ExistingDocumentResolver
- "Create new instead" button should be light blue when not active (currently inconsistent green/blue)
- Move "Create new instead" outside the "Exact Match" / "Likely Match" card

## Step 3 — Execution per-font list
- Loading spinner/status should be on the right, with reserved fixed width so it doesn't jump around as file type text changes
- Upload complete success icon needs brighter/more visible green (currently illegible like the error icon was)

## Step 3 — Counter bug (STILL BROKEN)
- Counter stays at "0 of X" during upload — onProgress events not incrementing completedCount

## General
- Use positive/success green more prominently where applicable instead of ghost/muted green
