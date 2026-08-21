# Active Context — @liiift-studio/sanity-font-manager

Last updated: 2026-08-15

## Recent state

- **Unreleased — OpenType feature titles from the font.** `Detect OTF` now titles a stylistic set
  or character variant with the name the foundry put in the font (`ss01` → "Alternate g") instead
  of the canonical "Stylistic Set 1". `getFeatureUiNames` in `fontHelpers` reads each feature's
  FeatureParams — `UINameID` for ssXX, `featUiLabelNameId` for cvXX — resolves it through the name
  table, and both writers (`generateFontData`, `buildUploadPlan`) store the result in the font
  document's `opentypeFeatures.featureList`, a `[{tag, title}]` field MCKL's schema already
  declared but nothing wrote. `detectOpenTypeFeatures` unions those labels across the family's
  styles, first style to name a tag winning.
  - Title precedence (`chooseTitle`): an editor's own wording > the font's label > the canonical
    title. A stored title equal to the canonical one counts as auto-filled and is replaced —
    without that, the old `title: meta.title` + value-spread meant any typeface detected once
    could never pick a font label up.
  - Provenance is not recorded, so a font label, once written, reads as editor wording on the next
    run: re-uploading a font that *renames* a set will not overwrite it. Clear the title and
    re-detect.
  - Only single-tag features can inherit a name; `pnum onum` and `allStylisticSets` are our
    groupings, which no font labels.
  - **Existing font documents have no `featureList`** — it has never been written. Names appear
    only after each font's data is regenerated (`regenerateFontData` / re-upload).
  - Only MCKL's font schema declares `featureList`; Darden and TDF would store it as an unknown
    field until theirs do. `opentypeFeatures` is hidden in the Studio, so nothing shows either way.
  - 23 new tests (`fontHelpers`, `detectOpenTypeFeatures`, plus a `mockLayoutTable` fixture).

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

- **`pako` is imported but never declared.** `utils/setupDecompressors.js` imports `pako`, which is
  absent from `dependencies`, so 8 test files fail to load on a clean `npm ci` (`libfont-integration`,
  `generateFontData`, `processFontFiles`, `planReducer`, `generateCssFile`, `retitleFontEntries`,
  `parseFontImportOrder`, and one more) — 1 failing test, 263 passing. Pre-existing and unrelated to
  the feature-titles work; consumers get `pako` hoisted from their own Studio install, which is why
  it has gone unnoticed. Adding it to `dependencies` should fix all 8.

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
