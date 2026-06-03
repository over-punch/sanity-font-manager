# Migration Guide: v2.x → v3.0 (Upload Modal Overhaul)

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md)

---

## Breaking Changes Summary

The upload modal overhaul is a **semver major** bump (v2.x → v3.0) because it changes internal utility function signatures. While these functions are not part of the documented public API, consumer studios import and call them directly.

| Change | Impact |
|---|---|
| `processFontFiles()` signature changed | Returns additional `decisions` audit trail data |
| `uploadFontFiles()` split into `buildUploadPlan()` + `executeUploadPlan()` | Old function removed |
| `updateTypefaceDocument()` accepts options object + uses dot-path patch keys | Signature change (positional → options object) + behavior fix (dot-path preserves siblings) |
| `resolveExistingFont()` added | New export, no breakage |
| `resolveWeight()` replaces inline `determineWeight()` | New export, old function still works but is deprecated |

---

## Consumer Studios

| Studio | Package Pin | Branch | Notes |
|---|---|---|---|
| MCKL | Local fork | `fix/font-uploader-preserve-filenames` | Drop fork branch after upgrade — all fixes included |
| TDF | `^2.3.x` | `feature/font-uploader-v2` | Bump to `^3.0.0` |
| Darden | `^2.3.x` | `feature/font-uploader-v2` | Bump to `^3.0.0` |

---

## Migration Steps Per Studio

### 1. Update package.json

```diff
- "@liiift-studio/sanity-font-manager": "^2.3.19"
+ "@liiift-studio/sanity-font-manager": "^3.0.0"
```

### 2. Check for direct utility imports

Search the studio codebase for direct imports from the package:

```bash
grep -r "sanity-font-manager" --include="*.js" --include="*.jsx" --include="*.ts" --include="*.tsx"
```

**If the studio only uses the exported components and schema fields** (the normal case): No code changes needed. The `BatchUploadFonts` component and all schema fields maintain the same API.

**If the studio imports utility functions directly** (e.g., MCKL's fork):

| Old Import | New Import | Notes |
|---|---|---|
| `import { processFontFiles } from '.../processFontFiles'` | Same import, but return shape has new `decisions` field | Non-breaking if studio doesn't destructure deeply |
| `import { uploadFontFiles } from '.../uploadFontFiles'` | `import { buildUploadPlan, executeUploadPlan } from '.../buildUploadPlan'` and `.../executeUploadPlan'` | Breaking — see mapping below |
| `import { updateTypefaceDocument } from '.../updateTypefaceDocument'` | Same import | Signature accepts options object now |
| `import { determineWeight } from '.../processFontFiles'` | `import { resolveWeight } from '.../weight'` | Old export preserved as deprecated wrapper |

### 3. Function signature mapping

#### `uploadFontFiles` → `buildUploadPlan` + `executeUploadPlan`

**Before (v2):**
```js
const { fontRefs, variableRefs, failedFiles } = await uploadFontFiles(
  fontsObjects, subfamilies, client, inputPrice, stylesObject, setStatus, setError
);
```

**After (v3):**
```js
// Phase 1: Build plan (replaces processFontFiles + resolution logic)
const plan = await buildUploadPlan({
  files: sortedFiles,
  typefaceTitle: title,
  settings: { price: inputPrice, preserveShortenedNames, preserveFileNames },
  client,
  stylesObject,
  onProgress: (event) => { /* update UI */ },
});

// Phase 2: Execute plan (replaces uploadFontFiles)
const result = await executeUploadPlan({
  plan,
  client,
  docId: doc_id,
  stylesObject,
  onProgress: (event) => { /* update UI */ },
});

// result.fontRefs, result.variableRefs, result.failedFonts
```

#### `updateTypefaceDocument` — options object

**Before (v2):**
```js
await updateTypefaceDocument(
  doc_id, fontRefs, variableRefs, subfamilies, uniqueSubfamilies,
  subfamiliesArray, preferredStyleRef, newPreferredStyle,
  stylesObject, client, setStatus, setError
);
```

**After (v3):**
```js
await updateTypefaceDocument({
  docId: doc_id,
  fontRefs,
  variableRefs,
  subfamilies,
  uniqueSubfamilies,
  subfamiliesArray,
  preferredStyleRef,
  newPreferredStyle,
  stylesObject,
  client,
  onProgress: (event) => { /* update UI */ },
});
```

### 4. MCKL-specific: Drop the fork branch

After upgrading to v3.0:
- The `fix/font-uploader-preserve-filenames` branch on `mckl/cms` is fully superseded
- All 9 commits from that branch are included in v3.0
- Delete the branch and remove any local overrides of font uploader files
- Run the `npm link` scripts to verify: `npm run link:mckl`

### 5. Verify the upgrade

After bumping the version:

1. **Build check:** `npm run build` in the studio — should compile without errors
2. **Smoke test:** Open a typeface document in the studio, verify:
   - The upload button opens the new modal
   - Settings (price, toggles) are visible in Step 1
   - Dropping font files triggers processing with card-by-card appearance
   - Review cards are editable
   - Upload executes and fonts appear in the typeface's styles list
3. **Data preservation check:** Verify that existing `styles.collections`, `styles.pairs`, `styles.free`, and `styles.displayStyles` are not wiped after an upload
4. **preferredStyle check:** Verify that a non-empty preferredStyle is not overwritten by a new upload

---

## Deprecation Period

The following exports are preserved in v3.0 as deprecated wrappers. They will be removed in v4.0:

| Deprecated Export | Replacement | Wrapper behavior |
|---|---|---|
| `determineWeight(font, weightName)` | `resolveWeight(usWeightClass, weightName)` | Extracts `font['OS/2'].usWeightClass` and calls `resolveWeight` |
| `uploadFontFiles(...)` | `buildUploadPlan()` + `executeUploadPlan()` | Calls both sequentially with auto-accepted suggestions (no review step). For `ambiguous` recommendations: defaults to `create` and logs warning. |

Deprecated functions log `console.warn('Deprecated: ...')` on first call.

---

## New Exports in v3.0

| Export | Module | Description |
|---|---|---|
| `buildUploadPlan` | `utils/buildUploadPlan.js` | Phase 1 orchestrator |
| `executeUploadPlan` | `utils/executeUploadPlan.js` | Phase 2 orchestrator |
| `resolveExistingFont` | `utils/resolveExistingFont.js` | Document resolution helper |
| `resolveWeight` | `utils/weight.js` | Unified weight classification |
| `FONT_STATUS` | `utils/planTypes.js` | Status enum constants |
| `PLAN_PHASE` | `utils/planTypes.js` | Phase enum constants |
| `RECOMMENDATION` | `utils/planTypes.js` | Document resolution recommendation enum |
| `EXECUTION_STATUS` | `utils/planTypes.js` | Execution progress status enum |

---

## Changelog Entry (v3.0.0)

```markdown
## 3.0.0

### Breaking Changes
- `uploadFontFiles()` removed — replaced by `buildUploadPlan()` + `executeUploadPlan()`
- `updateTypefaceDocument()` now accepts an options object instead of 12 positional parameters
- Minimum Sanity version: >=3 (unchanged)

### New Features
- Upload modal with step-by-step review: settings → processing → review → upload
- Every automated decision (title, weight, style, subfamily, document resolution) is now visible and editable before upload
- Existing document resolution with exact, candidate, and content matching
- Subfamily organization with visual grouping and reassignment
- Per-font progress indicators during upload
- Retry failed uploads without re-uploading successful assets

### Bug Fixes
- Typeface patch now uses dot-path keys — no longer wipes `styles.collections`, `styles.pairs`, `styles.free`, or `styles.displayStyles`
- `preserveFileNames` feature now works end-to-end (ID, title, and asset filename all derived from original filename)
- `preferredStyle` is only set when currently empty (no longer overwrites existing selection)
- `sanitizeForSanityId` uses deterministic hashing for long names (no more `Math.random`)
- Variable font subfamily preserved for non-optical-size VFs (no longer unconditionally cleared)
- Weight classification unified — "UltraBold" correctly maps to 800, "Heavy" to 900
- Italic detection now checks OS/2 `fsSelection` bits

### Deprecated
- `determineWeight()` — use `resolveWeight()` instead
- `uploadFontFiles()` — use `buildUploadPlan()` + `executeUploadPlan()` instead
```
