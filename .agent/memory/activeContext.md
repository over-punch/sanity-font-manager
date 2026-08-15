# Active Context — @liiift-studio/sanity-font-manager

Last updated: 2026-08-15

## Recent state

- **v2.17.0 published** (2026-08-13). Adds `createFontFileFields()` — a factory for the font
  document's `fileInput` object, following the `createStylesField` / `createOpenTypeField`
  convention. The nine per-format fields were hand-copied into all three consumer schemas; they now
  spread the factory instead. `derived: false` omits woff2_subset/woff2_web for a site with no
  subset-capable fontWorker. 11 tests, 395 total. All three studios are on `^2.17.0`.
  That release also carries a concurrent session's SingleUploaderTool web/subset commit, which had
  bumped the local version to 2.17.0 without publishing.

- **v2.16.0 published** (2026-08-12). Upload-wizard merge + data-safety release, driven by an Omnes
  variable-font upload where one style split into several review entries.
  - `utils/mergeFontEntries.js` + `components/MergeFontsDialog.jsx` — fold several review entries into
    one document. Files are combined and deduped by format; the primary supplies every reviewed value;
    binary-derived fields follow the surviving TTF/OTF. Reachable from ticked entries in the bulk bar
    and from the duplicate-ID banner.
  - **Every create now re-checks its target `_id` before writing.** Resolution runs once per file at
    plan time, so any rename during review pointed `createOrReplace` at an unverified `_id` and could
    destroy a live document. An occupied `_id` is patched instead and reported in the summary.
  - `_idConflict` is recomputed after adds, removals, resets and merges (`markConflicts` in
    planReducer). Previously a removal left the survivor permanently flagged with no way to clear it.
  - The TTF-companion name fallback is finally wired into `buildFontPlanEntry`. It lived in
    `processFontFiles` but the two-phase plan builder never called it — the root cause of one style
    parsing to different titles per format.
  - "Preserve file names" works when toggled during review (`retitleFontEntryFromFileName`); it was
    previously a silent no-op after processing.
  - New warnings with a Show button that filters to the fonts named: no TTF/OTF (metadata generation
    is gated on the outline), duplicate formats within one entry, weight outside the wght axis (now
    checked for detected values too, with an axis-default fix button), missing title/ID.
  - Failed-to-parse entries can be retried without restarting the batch.

- Rolled out to **all three** studios at `^2.17.0` (Darden main, TDF staging, MCKL staging).
- 395 tests passing.

## Pending work

- **Studio redeploys.** TDF's Studio was deployed 2026-08-13 (before the createFontFileFields swap —
  functionally identical fields, so cosmetic). **Darden's and MCKL's Studios have NOT been deployed**
  since 2.17.0; MCKL's `webAndSubset: true` is not live until its Studio ships.
- **Port MCKL "preserve file names" fixes into this package.** A 9-commit fix branch on `mckl/cms`
  (`fix/font-uploader-preserve-filenames`, HEAD `6c35828`) also stops the typeface patch from wiping
  `styles.collections` / `styles.pairs` and makes `preferredStyle` sticky. Plan at
  `.agent/specs/plans/mckl-fixes-port.md`. The `preserveFileNames` half is now effectively covered by
  the two-phase pipeline; the typeface-patch and preferredStyle halves have NOT been verified.

## Out-of-scope follow-ups

- `generateCollectionsPairsComponent.jsx` uses `createOrReplace` for pairs / collections, silently
  rewriting customisations and the contents of docs that historical orders reference. The font path
  is now guarded against this; the collections path is not.
- `glyphRowCatalogue.js` seeds stylistic sets with the full alphabet instead of the characters each
  ssNN actually affects — proper fix is storing per-feature affected characters at upload time.
