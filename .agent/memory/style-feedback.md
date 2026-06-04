# Upload Modal — Style & UX Feedback

Collected during testing. Items marked ✅ have been fixed.

## Step indicators (modal header)
- Active step text should be white, not blue — hard to read on the blue background

## Step 2 — Processing progress bar
- Use success green for the progress bar while processing

## Step 2 — BulkActions bar
- Add "Filter" label on top of the filter dropdown (not just beside it)
- "Expand All" button should be below search/filter row, above the sortable column headers
- Filter dropdown counts should show total font **documents**, not total files

## Step 3 — Upload execution
- ✅ Counter fixed (fontProgress events added)
- ✅ Retry filtering fixed (only failed fonts)
- Move the per-font loader/status indicator to the right of the file type badge (outside the card), don't increase card width when loader finishes

## Step 3 — Upload Summary (post-completion)
- ✅ Icons fixed (bright green/red)
- ✅ Failed Fonts badge fixed
- ✅ Padding fixed

## Modal behavior
- ✅ Click-outside-to-close disabled

## Schema-level changes (per foundry, not in font uploader package)
- Move "Utilities" button above the fonts array list
- Move "Generate Collections" component above the collections array
- Move "Generate Full Family Collection" component above its array
- These are field ordering changes in each foundry's typeface schema

## General
- Use positive/success green more prominently where applicable instead of ghost/muted green
- ✅ Removed overflow hidden / text-overflow ellipsis from all text elements (was interfering with Sanity UI's pseudo-element centering)
