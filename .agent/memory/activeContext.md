# Active Context — @liiift-studio/sanity-font-manager

Last updated: 2026-09-15

## Recent state

- **2.23.0 (branch `feature/trial-fonts`, not yet published) — env-gated trial (DEMO) fonts.** Asked for
  by TDF, built cross-foundry: everything keys off `SANITY_STUDIO_TRIAL_UNICODE_RANGE`, and a studio
  that leaves it unset gets no field, no row and no requests. Optional `SANITY_STUDIO_TRIAL_LABEL`
  (default `DEMO`).
  - `utils/trialFonts.js` — config/normalising, `generate-trial` request, collect, verify, generate.
    Mirrors `generateWebAndSubset` (4 at a time, no-cors, AbortController, Sanity poll) with two
    differences: requests get 90s (Pyodide cold start on the site), and verification waits for a
    **different asset ref**, so a forced rebuild is never confirmed by the trial it replaces.
  - `fileInput.trial` is a `file` with `unicodeRange` + `label` sub-fields written by the worker. That
    is the staleness signal: change the env range and every existing trial reads as stale.
  - Wiring: `createFontFileFields` (trial defaults to `derived && enabled`, so script variants never get
    one), `executeUploadPlan` trial phase after web/subset (forced for the run's fonts),
    `UploadStep3Execute` status, `SingleUploaderTool` TRIAL row + rebuild on OTF upload/build or TTF
    upload with no OTF, `BatchUploadFonts` Utilities → Generate Trial Fonts (+ rebuild-current switch).
  - The site does the build. TDF's reference is `lib/buildTrialFont.js` (subset + rename in one
    fontTools pass under Pyodide) and `scripts/generate-trial-fonts.js` for the dataset backfill.
  - Tests: `trialFonts.test.js` (new) and `fontFileFields.test.js`. The component files are not
    covered by tests.

- **`fix/batch-upload-hang` — the typeface patch could hang the uploader forever.** Reported by
  MCKL: the batch uploader sits on "Updating typeface document..." with every font asset and
  document already committed. The status is set by the `typeface-patching` event in
  `executeUploadPlan` and only cleared when the whole run resolves, so the stall is inside
  `updateTypefaceDocument`. Two defects, both present unchanged from 2.11.9 through 2.20.0 — the
  commit path never moved, so no version bump was ever going to fix this.
  - **No deadline.** Nothing bounded a Sanity request in that function, so a stalled fetch or
    commit hung its await permanently. `withTimeout` and `TYPEFACE_PATCH_TIMEOUT_MS` (60s) now wrap
    the stale-reference lookup, the draft commit, and the published lookup and commit.
  - **Swallowed errors.** The commit's `catch` reported through `setStatus`/`setError` and returned
    normally, so `executeUploadPlan`'s `catch` was unreachable, `result.typefacePatchError` stayed
    `null`, and a failed patch was reported as a *successful* upload. `UploadSummary`'s
    retry-the-patch button had the same hole — it awaits `updateTypefaceDocument` in a `try/catch`
    that could never fire, so every retry claimed success. Rethrows after reporting now.
  - Logs `Typeface patch size: { fonts, variableFont, subfamilyRefs, bytes }` before the commit.
    Deliberately did **not** split the patch into several commits: `styles.fonts` and
    `styles.subfamilies[].fonts` have to agree, and a half-applied write recreates exactly the
    orphaned-reference corruption v2.19.1 was written to stop. Split only with size evidence.
  - `executeUploadPlan` now emits `web-subset-collecting`, and `UploadStep3Execute` shows
    "Generating web copies and subsets" for it. The web/subset phase runs *after* the patch and
    polls for up to three minutes; with the status left unchanged it read as the same hang.
  - Root cause of the original stall is still unconfirmed — it needs a console from a live repro.
    The timeout converts the freeze into `Typeface patch timed out after 60s`, which is the
    diagnostic. 467 tests pass.

- **v2.19.1 — stop orphaning font references, and stop refreshing features with nothing.**
  - `updateTypefaceDocument` only ever appended to `styles.fonts`, `styles.variableFont` and each
    `styles.subfamilies[].fonts`, so a font whose document id changed stayed referenced forever. The
    dead reference dereferences to `null`, and one `null` in a subfamily is enough to fail MCKL's
    whole site build — `pairItalics` in `pages/typefaces/[typeface].js` reads `.weightName` off every
    entry. Seen live: Owners' seven `owners-*-italic` documents were retitled onto
    `owners-*-regular-italic` ids, `styles.fonts` came out clean, and all seven subfamilies kept
    pointing at the deleted originals. One existence query now prunes dead refs across every array
    the patch writes; a draft-only font counts as live so a style mid-creation is never pruned, and
    a failed lookup leaves the arrays untouched rather than wiping them.
  - `executeUploadPlan` refreshed `opentypeFeatures` on any truthy value, including the
    parse-failure `{ chars: [], featureList: [] }` — gated on `chars.length` now.

- **v2.19.0 — the variable font is the source of truth for labels.** `collectSupportedTags` now
  feeds documents through `orderByAuthority`, a stable sort putting `variableFont === true` first, so
  a VF's names beat the statics' while statics still fill tags the VF leaves unnamed. `SetOTF`'s GROQ
  projects `variableFont` to make that possible. 6 new tests, 424 total.
  - Chosen over "VF is the only source when one exists": a family whose VF has not been rebuilt yet
    would otherwise show canonical titles even where its statics carry names.

- **v2.18.0 — OpenType feature titles from the font.** Version bumped, **not yet published**, and
  no Studio is on `^2.18.0` yet. `Detect OTF` now titles a stylistic set
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

- **MCKL's deployed fontWorker strips `featureList`.** `site/pages/api/sanity/fontWorker.js` on `main`
  writes `opentypeFeatures: { chars: font.availableFeatures }`, replacing the whole object — so the
  site's "Rebuild All from TTF" path wipes any labels the Studio wrote. A fontkit mirror of
  `getFeatureUiNames` exists at `site/lib/openTypeFeatureNames.js` and the fix is in the site repo's
  working tree on `feature/opentype-feature-titles`, but is **uncommitted and undeployed**. Until it
  ships, Studio-side Build and the site-side rebuild fight over this field.

- **MCKL's Owners typeface still has the seven dangling subfamily references** that exposed the
  orphaning bug. 2.19.1 stops new ones appearing but does not repair existing data: the refs must be
  repointed to the `owners-*-regular-italic` ids, or the site build keeps failing on
  `/typefaces/owners`. A null guard in `pairItalics` would also stop one dead reference taking down
  a whole build; neither is done.

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
