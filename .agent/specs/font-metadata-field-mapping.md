# Font Metadata Field Mapping

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [upload-modal-overhaul.md](./plans/upload-modal-overhaul.md), [plan-types.md](./plan-types.md)

Single source of truth for how OpenType name table fields map through fontkit to plan object fields to Sanity document fields.

---

## OpenType Name Table → fontkit v2 Properties

| Name ID | OpenType Field | fontkit v2 Property | Type | Notes |
|---|---|---|---|---|
| 0 | Copyright | `font.copyright` | `string` | |
| 1 | Font Family | `font.familyName` | `string` | RIBBI model (max 4 styles per family) |
| 2 | Font Subfamily | `font.subfamilyName` | `string` | Only Regular/Bold/Italic/Bold Italic in RIBBI |
| 4 | Full Name | `font.fullName` | `string` | Display name, may be truncated to 63 chars |
| 5 | Version | `font.version` | `string` | Prefixed with "Version " |
| 6 | PostScript Name | `font.postscriptName` | `string` | No spaces, ASCII only |
| 16 | Typographic Family | `font.name.records[16]` | `object\|undefined` | Language-keyed object `{ en: "...", de: "..." }`. Preferred over ID 1 for large families. |
| 17 | Typographic Subfamily | `font.name.records[17]` | `object\|undefined` | Language-keyed object. Preferred over ID 2 for large families. |

> **fontkit v2 API note:** Name IDs 16 and 17 are accessed via numeric keys on `font.name.records`, NOT string-keyed properties. `font.name.records.preferredFamily` does not exist. The correct access is `font.name.records[16]` and `font.name.records[17]`.

> **OS/2 table access:** Verify the installed fontkit version's API surface for OS/2 table access. The bracket accessor `font['OS/2']` is not guaranteed as public API across fontkit forks. Confirm the correct accessor (may be `font.os2`, `font.directory.tables['OS/2']`, or require explicit decode) before implementation.

### Language-keyed fields

Name IDs 16 and 17 return language-keyed objects: `{ en: "Bold", de: "Fett" }`. Always extract the `en` value first, falling back to the first available key:

```js
function extractNameString(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    return value.en || value[Object.keys(value)[0]] || '';
  }
  return '';
}
```

### TrueType Collections (TTC)

fontkit may return a `TrueTypeCollection` for `.ttc` files. Collection members require indexing (`font.fonts[0]`) to access face-level properties like `variationAxes` and `name.records`. Calling these on the collection root returns `undefined` or throws. Guard with:

```js
const face = font.fonts ? font.fonts[0] : font;
```

---

## Metadata → Plan Object Field Derivation

### Title (`FontPlanEntry.title`)

| Priority | Source | Condition | Processing |
|---|---|---|---|
| 1 | Original filename | `preserveFileNames === true` | Strip extension, replace hyphens with spaces, split camelCase, title-case |
| 2 | `font.fullName` (name ID 4) | Always available | `formatFontTitle()`: strip hyphens, title-case, optionally expand abbreviations |
| 3 | `extractNameString(font.name.records[16])` + `extractNameString(font.name.records[17])` (IDs 16+17) | Fallback if fullName is empty/garbage | Concatenate with space, title-case |
| 4 | Original filename | Last resort if all metadata is empty | Strip extension, replace hyphens with spaces |

**`decisions.title.source`** for priority 3 should be `'fontkit-preferredFamily+preferredSubfamily'` since it combines two fields.

**Alternatives array** (`decisions.title.alternatives`): Always populated with values from ALL sources so user can pick:

| Source key | Value |
|---|---|
| `nameId1-familyName` | `font.familyName` |
| `nameId4-fullName` | `font.fullName` (raw, unprocessed) |
| `nameId6-postscriptName` | `font.postscriptName` |
| `nameId16-preferredFamily` | `extractNameString(font.name.records[16])` |
| `nameId17-preferredSubfamily` | `extractNameString(font.name.records[17])` |
| `filename` | Original filename without extension |

### Document ID (`FontPlanEntry.documentId`)

| Priority | Source | Processing |
|---|---|---|
| 1 | Derived from title | `sanitizeForSanityId(title)` |
| 2 | Derived from filename | `sanitizeForSanityId(filename)` when `preserveFileNames` is on |

**Note:** When `preserveFileNames` is on, priority 1 and 2 produce the same result (title is itself derived from filename). `decisions.documentId.source` should be `'derived-from-title'` in both cases — the title's source already records the filename origin.

### Weight (`FontPlanEntry.weight`)

| Priority | Source | fontkit Property | Notes |
|---|---|---|---|
| 1 | OS/2 usWeightClass | OS/2 table accessor (see API note above) | Most reliable. Range: 1-1000. |
| 2 | Keyword match against weightName | See [weight-classification-reference.md](./weight-classification-reference.md) | Used when OS/2 is missing or 0 |
| 3 | Default | — | 400 (Regular) |

### Weight Name (`FontPlanEntry.weightName`)

| Priority | Source | Processing |
|---|---|---|
| 1 | `extractNameString(font.name.records[17])` (ID 17) | Strip italic keywords, optionally expand abbreviations |
| 2 | `font.subfamilyName` (ID 2) | Same processing |
| 3 | Extracted from `fullName` minus typeface title | When subfamily is empty or "Roman" |

### Style (`FontPlanEntry.style`)

| Priority | Source | Condition | Result |
|---|---|---|---|
| 1 | OS/2 `fsSelection` bit 0 | `fsSelection & 0x01` (ITALIC bit) | `'Italic'` |
| 2 | `head.macStyle` bit 1 | `macStyle & 0x02` (Italic bit) | `'Italic'` |
| 3 | Name contains "italic" | Case-insensitive check on fullName | `'Italic'` |
| 4 | `font.italicAngle` | `!== 0` | `'Italic'` |
| 5 | Default | — | `'Regular'` |

> **Corrections from panel review:**
> - Removed OS/2 `fsSelection` bit 9 (0x200) — this is the `USE_TYPO_METRICS` flag, NOT an oblique indicator. Using it causes false positive italic detection on most modern fonts.
> - Added `head.macStyle` bit 1 as priority 2 — a reliable italic indicator alongside fsSelection bit 0.
> - Demoted `italicAngle !== 0` to priority 4 — many upright fonts have non-zero italic angles (e.g., Courier at -13°, monospace fonts with vestigial post table values). This produces false positives and should only be checked after other signals.

### Subfamily (`FontPlanEntry.subfamily`)

| Priority | Source | Processing |
|---|---|---|
| 1 | `extractNameString(font.name.records[16])` minus typeface title | If preferredFamily contains more than the typeface name (e.g., "Halyard Display" - "Halyard" = "Display"). **Note:** assumes typeface title is a prefix of preferredFamily. If it is not a prefix (suffix, embedded, or differs in case), the subtraction fails — fall through to priority 2. |
| 2 | `font.fullName` minus typeface title, minus weight keywords, minus italic keywords | String subtraction with keyword stripping |
| 3 | Default | Empty string `''` |

> **Correction from panel review:** Default changed from `'Regular'` to `''` (empty string). Empty string is the expected value for fonts with no optical sub-family distinction. Forcing `'Regular'` creates spurious subfamily groups in the typeface document.

**Variable font exception:** See [variable-font-axis-handling.md](./variable-font-axis-handling.md) — only clear subfamily when the VF has an `opsz` axis with real range.

### Variable Font (`FontPlanEntry.variableFont`)

| Condition | Result |
|---|---|
| `font.variationAxes` exists AND at least one axis has `min !== max` | `true` |
| Otherwise | `false` |

**TTC guard:** Access `variationAxes` on the face, not the collection root. See TTC section above.

---

## Plan Object → Sanity Document Fields

| Plan Field | Sanity Font Document Field | Notes |
|---|---|---|
| `documentId` | `_id` | Also used as `slug.current` |
| `title` | `title` | |
| `title` (lowercase, slugified) | `slug.current` | |
| `settings.price` | `price` | |
| `settings.price > 0` | `sell` | `true` if price > 0 |
| `weight` | `weight` | Number |
| `weightName` | `weightName` | |
| `style` | `style` | "Regular" or "Italic" |
| `subfamily` | `subfamily` | |
| `variableFont` | `variableFont` | Boolean |
| `files[].ttf` asset ref | `fileInput.ttf` | `{ _type: 'file', asset: { _ref, _type: 'reference' } }` |
| `files[].otf` asset ref | `fileInput.otf` | Same shape |
| `files[].woff` asset ref | `fileInput.woff` | Same shape |
| `files[].woff2` asset ref | `fileInput.woff2` | Same shape |
| Generated CSS asset ref | `fileInput.css` | Same shape |
| fontkit metadata | `metaData` | `{ postscriptName, fullName, familyName, subfamilyName, copyright, version, genDate }` |
| fontkit metrics | `metrics` | `{ unitsPerEm, ascender, descender, lineGap, underlinePosition, underlineThickness, italicAngle, capHeight, xHeight, boundingBox }` |
| fontkit features | `opentypeFeatures` | `{ chars: [...feature tags] }` |
| fontkit characterSet | `characterSet` | `{ chars: [...codepoints] }` |
| fontkit variableAxes | `variableAxes` | **JSON.stringify()** before writing — Sanity will reject raw objects. `executeUploadPlan` must serialize during document creation. |
| fontkit variableInstances | `variableInstances` | JSON stringified |
| Glyph count | `glyphCount` | Number |
| Typeface title | `typefaceName` | From parent typeface |

---

## Sanity Typeface Document Patch

The typeface document is patched using **dot-path keys** to preserve sibling fields:

| Patch Key | Value | Notes |
|---|---|---|
| `'styles.fonts'` | `[...existing, ...newFontRefs]` | Append new references |
| `'styles.variableFont'` | `[...existing, ...newVFRefs]` | Append new VF references |
| `'styles.subfamilies'` | Updated subfamily array | Merge new groups, deduplicate refs within groups |
| `preferredStyle` | Reference | Only set if currently empty |

Fields NOT touched (preserved by dot-path approach):
- `styles.collections`
- `styles.pairs`
- `styles.free`
- `styles.displayStyles`

Generated `@font-face` blocks include `font-display: swap` by default. See [variable-font-axis-handling.md](./variable-font-axis-handling.md) for VF-specific CSS details.
