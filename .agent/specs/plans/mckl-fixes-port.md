# Port MCKL Font Uploader Fixes Into the Package

Status: Planned. Not yet started in this repo.
Source: `mckl/cms` submodule, branch `fix/font-uploader-preserve-filenames` (9 commits, HEAD `6c35828` as of 2026-05-28).
Target: This package (`@overpunch/sanity-font-manager`), currently at `v2.3.19`.

## Why

The "preserve file names" feature in this package is essentially non-functional:

- `processFontFiles.js` extracts `originalFilename` and propagates it through `createFontObject`.
- `uploadFontFiles.js` never reads it — `originalFilename` is silently dropped (`delete font.originalFilename`) before save and the asset is uploaded as `${fontObject._id}.${fileType}`.
- `_id` is always derived from `fontTitle` via `sanitizeForSanityId(fontTitle)` regardless of the toggle.
- The Sanity asset SHA1-dedup behaviour is not handled either way.

MCKL diverged its local copy with 9 commits that wire the feature end to end, fix several adjacent regressions (typeface patch wiping `styles.collections` / `styles.pairs`, `preferredStyle` overwrite), and add a structured `resolveExistingFont` helper that lays the groundwork for a future "review candidates" dialog. Those fixes belong upstream so all consumer studios benefit.

## Source commits to port

In MCKL submodule `mckl/cms` on branch `fix/font-uploader-preserve-filenames`:

| Commit | Summary |
|---|---|
| `fdbd95e` | Filename-derived font `_id` when preserveFileNames is on; post-upload `client.patch(baseAsset._id).set({ originalFilename })` to override Sanity SHA1 dedup |
| `aaca23b` | Title derived from filename (hyphen → space) when preserveFileNames is on |
| `c57922f` | Initial camelCase split (superseded) |
| `595372f` | Typeface patch uses dot-path keys (`'styles.fonts'`, `'styles.variableFont'`, `'styles.subfamilies'`) so sibling fields (collections, pairs, free, displayStyles) are preserved; `updatePreferredStyle` only sets when currently empty |
| `7678e46` | Apply camelCase split to ID as well as title (superseded) |
| `9525b9c` | Narrow camelCase split to "Italic" suffix only (superseded) |
| `f80067c` | Restore generic lower→Upper camelCase split (final form); ID and title derived from the same normalized string |
| `7a23be7` | Extract `resolveExistingFont` helper returning `{ exact, candidates, recommendation }` with four states (`use-exact`, `use-candidate`, `ambiguous`, `create`). Content-match fallback for legacy docs whose IDs predate the current naming convention |
| `6c35828` | Loosen lookup: ID query also matches `slug.current`; content-match is case-insensitive on `style`, `weightName`, `typefaceName`, `subfamily`; treats `null` / `''` / `'Regular'` as equivalent for default subfamily; treats `undefined` as `false` for `variableFont` |

The final state across all 9 commits is what should land in the package — the superseded ones do not need to be reproduced.

## Pre-port checklist

Conventions in this package that the MCKL diff does NOT follow (apply on the way in):

- **Tabs, not spaces.** MCKL uses 2- and 4-space mixes; this package uses tabs throughout (`.claude/rules/coding-standards.md`).
- **1-line file header summary at top of every file you create or significantly modify.** Existing files already follow this — preserve / update theirs, add for new files.
- **`sanitizeForSanityId` over raw `slugify`.** This package has `src/utils/sanitizeForSanityId.js` which handles `+` / `&` / `@` → words before slugify and enforces Sanity ID rules (leading letter/underscore, length cap). MCKL calls `slugify` directly — port should route through `sanitizeForSanityId`.
- **Parameterized GROQ.** The package uses `client.fetch(query, params)` with `$id` etc. throughout, even where MCKL inlines values. The MCKL diff already uses params for the new content query — keep that — but also confirm any GROQ that gets touched stays parameterized.
- **`parseVariableFontInstances` helper.** The package has a dedicated helper at `src/utils/parseVariableFontInstances.js` while MCKL inlines variable-instance logic in `uploadFontFiles.js`. The refactored helper is fine — do not regress to inline logic when porting.
- **Console logging conventions.** `console.error` / `console.warn` for errors / warnings (not `console.log`), and static strings start with a capital letter. MCKL is inconsistent on this — normalize on the way in.

## Detailed changes by file

### `src/utils/processFontFiles.js`

- Inside the main `processFontFiles` loop, replace the current `const id = sanitizeForSanityId(fontTitle);` block with the MCKL `preserveFileNames`-aware branch. Final logic (matching MCKL `f80067c`):
  - Extract `originalFilename = file.name.replace(/\.(ttf|otf|woff2?|eot|svg)$/i, '')` when `preserveFileNames` is true.
  - When `preserveFileNames && originalFilename`:
    - Compute `normalizedName = originalFilename.replace(/-/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\s+/g, ' ').trim()`.
    - Reassign `fontTitle = normalizedName` and `id = sanitizeForSanityId(normalizedName)`.
  - Otherwise: `id = sanitizeForSanityId(fontTitle)` (current behaviour).
- Change the `extractFontMetadata` destructure to `let` so `fontTitle` can be reassigned.
- No changes needed to `createFontObject` — it already accepts and stores `originalFilename`.

### `src/utils/uploadFontFiles.js`

- Add `preserveFileNames = false` to the `uploadFontFiles` signature (currently missing entirely).
- In the per-file upload loop, compute the asset filename conditionally:
  ```js
  const assetFilename = preserveFileNames && fontObject.originalFilename
      ? `${fontObject.originalFilename}.${fileType}`
      : `${fontObject._id}.${fileType}`;
  ```
- After `client.assets.upload(...)`, when `preserveFileNames` is on and `baseAsset.originalFilename !== assetFilename`, patch the asset doc:
  ```js
  await client.patch(baseAsset._id)
      .set({ originalFilename: assetFilename })
      .commit();
  ```
  Wrap in try/catch and `console.warn` on failure so a permissions issue on the patch does not abort the upload. Add a 1-2 line comment explaining the Sanity SHA1 dedup behaviour this is working around.
- Extract a new `resolveExistingFont(font, client)` helper (place above `createOrUpdateFontDocument`) that returns `{ exact, candidates, recommendation }`. Recommendation values: `'use-exact'`, `'use-candidate'`, `'ambiguous'`, `'create'`. Two queries inside:
  1. ID/slug match: `_id == $id || _id == $draftId || slug.current == $id`.
  2. Content-match fallback (only when ID query returns nothing):
     ```groq
     *[_type == 'font'
        && lower(typefaceName) == lower($typefaceName)
        && lower(weightName) == lower($weightName)
        && lower(style) == lower($style)
        && (variableFont == $variableFont || (!defined(variableFont) && $variableFont == false))
        && (
            lower(coalesce(subfamily, '')) == lower($subfamily)
            || (lower(coalesce(subfamily, '')) in ['', 'regular'] && lower($subfamily) in ['', 'regular'])
        )
     ]
     ```
     Single hit → `use-candidate`. Multiple hits → `ambiguous` (log and fall through to `create`). The full structure is the seam for the planned modal.
- Refactor `createOrUpdateFontDocument` to call `resolveExistingFont` and act on the recommendation. When `use-candidate`, reassign `font._id = candidates[0]._id` before delete-and-patch so existing inbound references resolve.

### `src/utils/updateTypefaceDocument.js`

- Replace the top-level `let patch = { styles: { fonts, subfamilies, variableFont } }` with dot-path keys so `.set(patch)` does not clobber `styles.collections`, `styles.pairs`, `styles.free`, `styles.displayStyles`:
  ```js
  let patch = {
      'styles.fonts': stylesObject.fonts ? [...stylesObject.fonts, ...fontRefs] : [...fontRefs],
      'styles.variableFont': stylesObject?.variableFont ? [...stylesObject.variableFont, ...variableRefs] : [...variableRefs]
  };
  ```
  And later: `patch['styles.subfamilies'] = subfamiliesArray;` (replacing `patch.styles.subfamilies = ...`).
- Simplify `updatePreferredStyle` to only set when currently empty:
  ```js
  const isCurrentlyEmpty = !preferredStyleRef?._ref || preferredStyleRef._ref === '' || preferredStyleRef._ref === null;
  const hasCandidate = newPreferredStyle?._ref && newPreferredStyle._ref !== '';
  if (isCurrentlyEmpty && hasCandidate) {
      patch.preferredStyle = { _type: 'reference', _ref: newPreferredStyle._ref, _weak: true };
  }
  ```
  Removes the live GROQ fetch and the "new weight > current weight" overwrite logic.

### `src/components/BatchUploadFonts.jsx`

- Pass `preserveFileNames` through to `uploadFontFiles(...)` (currently passed only to `processFontFiles`).
- No UI changes needed — the toggle already exists.

## Tests to write

Tests live in `src/tests/`. Add or extend:

- `processFontFiles.test.js` (already exists)
  - ID derivation: with `preserveFileNames=false`, ID comes from fontTitle (current behaviour).
  - ID derivation: with `preserveFileNames=true`, ID and title both come from normalized filename; camelCase boundaries split (`OwnersNarrow-RegularItalic.ttf` → id `owners-narrow-regular-italic`, title `Owners Narrow Regular Italic`).
  - X-prefixed shortenings stay intact (`Owners-XNarrowItalic.ttf` → title `Owners XNarrow Italic`).
- `updateTypefaceDocument.test.js` (already exists)
  - Dot-path patch keys preserve `styles.collections` / `styles.pairs` / `styles.free` when called with a stylesObject that includes them.
  - `updatePreferredStyle` no-ops when `preferredStyleRef._ref` is non-empty; sets when empty and `newPreferredStyle._ref` is set; no-ops when both empty.
- `uploadFontFiles.test.js` (new — write minimal cases since this file has heavier external deps):
  - `resolveExistingFont` returns `use-exact` when ID match hits.
  - `resolveExistingFont` returns `use-exact` when only slug match hits.
  - `resolveExistingFont` returns `use-candidate` with one content-match.
  - `resolveExistingFont` returns `ambiguous` with multiple content-matches.
  - `resolveExistingFont` returns `create` when nothing matches.
- `test-studio` integration: do at least one manual run with a typeface that has `styles.collections` and `styles.pairs` populated; verify they survive an upload.

## Style / code-review pass before commit

- Tabs everywhere — no leftover spaces from MCKL.
- 1-line file headers preserved / updated.
- Every new helper has a JSDoc block.
- All `client.fetch` calls use `$param` placeholders.
- All `slugify` calls route through `sanitizeForSanityId`.
- `console.warn` for the asset rename failure, `console.error` for catch blocks.

## Branching and release

- Branch off `main`: `feature/preserve-file-names` (or similar). Do the work in one or two logical commits — do not replay the MCKL history.
- Bump version to `2.4.0` (minor — the feature is behavioural, not breaking) in `package.json`. Update CHANGELOG if there is one.
- Open PR with a summary listing the 9 problems fixed and the structured `resolveExistingFont` shape so reviewers know the modal seam exists.
- After merge / publish, update consumer studios that pin via package.json:
  - `mckl/cms` — bump to `^2.4.0` and drop / merge the local fork branch.
  - `tdf` and Darden also pin `^2.3.2` on their `feature/font-uploader-v2` branches per parent `tools/sanity-tools/.agent/memory/activeContext.md` — they get the same fixes for free on the next bump.

## Out of scope (capture for follow-up)

The MCKL conversation surfaced several issues that did NOT get fixed and should be tracked separately:

- **`generateCollectionsPairsComponent.jsx`** uses `client.createOrReplace` for pairs and collections. This overwrites any customizations on existing pair/collection docs and silently rewrites historical order references (orders store pairs/collections as references, and the underlying doc contents change beneath them). Mitigation options:
  - Skip-if-exists (fetch first, only create for missing IDs).
  - Versioned slugs (`-v2` suffix) so existing references stay pinned to the original doc.
  - Snapshot-at-purchase on the order schema.
- **Two-phase upload flow (plan → execute)** to support a future "review candidates" modal that batches all decisions into one prompt instead of one-modal-per-file.
- **State machine refactor** of `BatchUploadFonts.jsx` once the modal lands.
