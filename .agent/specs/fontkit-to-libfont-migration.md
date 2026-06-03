# Font Parser Migration: fontkit → lib-font

Status: Draft — amended by panel review 2026-05-29
Last updated: 2026-05-29
Related: [font-metadata-field-mapping.md](./font-metadata-field-mapping.md), [variable-font-axis-handling.md](./variable-font-axis-handling.md), [plan-types.md](./plan-types.md), [plans/upload-modal-overhaul.md](./plans/upload-modal-overhaul.md)

---

## Why

fontkit reorganizes OpenType data into convenience properties (`font.fullName`, `font.familyName`, `font.name.records.preferredFamily`) that do not reliably match the raw font data. This has caused recurring bugs:

- Name IDs 16/17 accessed via fabricated string keys (`preferredFamily`, `preferredSubfamily`) that don't exist in fontkit v2's actual API
- `font.fullName` conflates platform-specific name records into a single string with undocumented priority logic
- `font.name.records` structure varies across fontkit versions and forks
- OS/2 table accessed via an undocumented bracket accessor (`font['OS/2']`) that isn't guaranteed stable
- Variable font instance names extracted via internal `_tables` property (`font._tables.name.records`)
- Webfont name record patching (`font.name.records = ttfFileData?.name?.records`) relies on fontkit internals

lib-font (v3.0.1) is designed as a font inspector that exposes raw OpenType table data via `font.opentype.tables.*` with no opinionated reorganization. Name records are accessed by numeric ID, table fields match the OpenType spec directly.

---

## lib-font Overview

- **Package:** `lib-font` v3.0.1
- **Module format:** ESM only (no CJS)
- **License:** MIT
- **Size:** ~514 KB unpacked
- **Browser requirements:** Modern browsers (no IE11). WOFF requires `pako` global. WOFF2 requires `unbrotli` global.

### Loading API

```js
import { Font } from "lib-font";

// From ArrayBuffer (the primary path for file uploads)
function parseFont(buffer, filename) {
	return new Promise((resolve, reject) => {
		const font = new Font("font");
		font.onload = (evt) => resolve(evt.detail.font);
		font.onerror = (evt) => reject(new Error(evt.detail?.message || 'Font parse failed'));
		font.fromDataBuffer(buffer, filename);
	});
}
```

**Key difference:** fontkit uses synchronous `fontkit.create(buffer)`. lib-font uses event-driven loading. All call sites that use `fontkit.create()` must become `await parseFont(buffer, filename)`.

### Table Access Pattern

All tables via `font.opentype.tables.<tag>`:

```js
const tables = font.opentype.tables;
tables.name              // name table
tables['OS/2']           // OS/2 table (bracket notation for slash in tag)
tables.head              // head table
tables.post              // post table
tables.fvar              // fvar table (null if not variable)
tables.STAT              // STAT table (STUB in lib-font 3.0.1 — see Known Gaps)
tables.maxp              // maxp table
tables.GSUB              // GSUB table
tables.GPOS              // GPOS table
tables.cmap              // cmap table
```

---

## Property Mapping: fontkit → lib-font

### Name Records

| fontkit | lib-font | Notes |
|---|---|---|
| `font.postscriptName` | `tables.name.get(6)` | PostScript name (name ID 6) |
| `font.fullName` | `tables.name.get(4)` | Full name (name ID 4) |
| `font.familyName` | `tables.name.get(1)` | Font family (name ID 1) |
| `font.subfamilyName` | `tables.name.get(2)` | Subfamily (name ID 2) |
| `font.copyright` | `tables.name.get(0)` | Copyright (name ID 0) |
| `font.version` | `tables.name.get(5)` | Version string (name ID 5) |
| `font.name.records.preferredFamily` | `tables.name.get(16)` | Typographic family (name ID 16) |
| `font.name.records.preferredSubfamily` | `tables.name.get(17)` | Typographic subfamily (name ID 17) |
| `font.name.records.fontSubfamily` | `tables.name.get(2)` | Same as subfamilyName |
| `font.name.records.fullName` | `tables.name.get(4)` | Same as fullName |
| `font._tables.name.records.fontSubfamily` | `tables.name.get(2)` | Internal access pattern eliminated |
| `font._tables.name.records.preferredSubfamily` | `tables.name.get(17)` | Internal access pattern eliminated |

**Language-specific access:** `tables.name.get(nameID)` returns the first match (typically English). For explicit language control, iterate `tables.name.nameRecords` and filter by `platformID`/`languageID`:

```js
function getNameRecord(nameTable, nameID, platformID = 3, languageID = 0x0409) {
	return nameTable.nameRecords.find(r =>
		r.nameID === nameID &&
		r.platformID === platformID &&
		r.languageID === languageID
	)?.string;
}
```

### Font Metrics

| fontkit | lib-font | Notes |
|---|---|---|
| `font.unitsPerEm` | `tables.head.unitsPerEm` | |
| `font.ascent` | `tables['OS/2'].sTypoAscender` | fontkit uses OS/2 typo metrics |
| `font.descent` | `tables['OS/2'].sTypoDescender` | Negative value |
| `font.lineGap` | `tables['OS/2'].sTypoLineGap` | |
| `font.underlinePosition` | `tables.post.underlinePosition` | |
| `font.underlineThickness` | `tables.post.underlineThickness` | |
| `font.italicAngle` | `tables.post.italicAngle` | |
| `font.capHeight` | `tables['OS/2'].sCapHeight` | |
| `font.xHeight` | `tables['OS/2'].sxHeight` | |
| `font.bbox` | `{ xMin: tables.head.xMin, yMin: tables.head.yMin, xMax: tables.head.xMax, yMax: tables.head.yMax }` | fontkit returns object; lib-font has individual fields |

### OS/2 Table

| fontkit | lib-font | Notes |
|---|---|---|
| `font['OS/2'].usWeightClass` | `tables['OS/2'].usWeightClass` | |
| `font['OS/2'].fsSelection` | `tables['OS/2'].fsSelection` | Raw uint16 in both. lib-font does not pre-parse bits. |
| `font['OS/2'].sFamilyClass` | `tables['OS/2'].sFamilyClass` | |

### Variable Font Data

| fontkit | lib-font | Notes |
|---|---|---|
| `font.variationAxes` | `tables.fvar?.axes` | Array of axis objects. lib-font: `{ tag, minValue, defaultValue, maxValue, flags, axisNameID }` |
| `font.namedVariations` | `tables.fvar?.instances` | Array of `{ subfamilyNameID, coordinates, postScriptNameID }` |
| `font.fvar?.instance` | `tables.fvar?.instances` | Same — fontkit's internal access |
| axis check: `axes.some(a => a.min !== a.max)` | `axes.some(a => a.minValue !== a.maxValue)` | Property names differ: `min`→`minValue`, `max`→`maxValue` |

**Axis iteration example:**
```js
const fvar = tables.fvar;
if (fvar) {
	const axisMap = {};
	for (const axis of fvar.axes) {
		axisMap[axis.tag] = {
			min: axis.minValue,
			max: axis.maxValue,
			default: axis.defaultValue,
			name: tables.name.get(axis.axisNameID) || axis.tag,
		};
	}
}
```

### OpenType Features

| fontkit | lib-font | Notes |
|---|---|---|
| `font.availableFeatures` | Custom traversal (see below) | fontkit returns a flat array of feature tags |

```js
function getAllFeatureTags(font) {
	const tags = new Set();
	const tables = font.opentype.tables;
	for (const layoutTable of [tables.GSUB, tables.GPOS]) {
		if (!layoutTable) continue;
		for (const scriptTag of layoutTable.getSupportedScripts()) {
			const script = layoutTable.getScriptTable(scriptTag);
			for (const langTag of layoutTable.getSupportedLangSys(script)) {
				const langsys = layoutTable.getLangSysTable(script, langTag);
				for (const feature of layoutTable.getFeatures(langsys)) {
					tags.add(feature.featureTag);
				}
			}
		}
	}
	return [...tags];
}
```

### Character Set / Glyph Count

| fontkit | lib-font | Notes |
|---|---|---|
| `font.numGlyphs` | `tables.maxp.numGlyphs` | |
| `font.characterSet` | `tables.cmap.getSupportedCharCodes(3, 1)` | Platform 3 (Windows), encoding 1 (Unicode BMP). Returns array of code points. |
| `font.hasGlyphForCodePoint(cp)` | `tables.cmap.supports(String.fromCodePoint(cp))` | lib-font takes a character string, not a code point |

### Head / Post

| fontkit | lib-font | Notes |
|---|---|---|
| `font.head.macStyle` | `tables.head.macStyle` | Raw uint16 |

---

## WOFF / WOFF2 Decompression

lib-font detects the format from magic bytes and handles decompression automatically — but requires external decompression libraries loaded in the global scope:

| Format | Browser Requirement | Size |
|---|---|---|
| WOFF | `globalThis.pako` — load pako.js | ~50 KB |
| WOFF2 | `globalThis.unbrotli` — load unbrotli.js from lib-font's `lib/` folder | ~200 KB |

### Loading strategy for the plugin

Since this runs in Sanity Studio (browser), load decompression libraries lazily:

```js
async function ensureDecompressors() {
	if (!globalThis.pako) {
		const pako = await import('pako');
		globalThis.pako = pako;
	}
	if (!globalThis.unbrotli) {
		// unbrotli.js from lib-font/lib/ sets globalThis.unbrotli on load
		await import('lib-font/lib/unbrotli.js');
	}
}
```

**Alternative:** Bundle pako and unbrotli into the plugin's build. They are small enough (~250 KB combined) and font uploads always need them.

---

## Files to Modify

### Core parsing (every `fontkit.create()` call site)

| File | Current | Change |
|---|---|---|
| `src/utils/processFontFiles.js` | `fontkit.create(fontBuffer)` (lines 50, 132) | `await parseFont(fontBuffer, file.name)` |
| `src/utils/generateFontData.js` | `fontkit.create(buffer)` (line 56) | `await parseFont(buffer, filename)` |
| `src/utils/generateCssFile.js` | `fontkit.create(Buffer.from(arrayBuffer))` (lines 109, 144) | `await parseFont(arrayBuffer, filename)` |
| `src/utils/getEmptyFontKit.js` | `fontkit.create(fontBuffer)` (line 15) | `await parseFont(fontBuffer, file.name)` |
| `src/utils/regenerateFontData.js` | `fontkit.create(fontBuffer)` (line 103) | `await parseFont(fontBuffer, filename)` |
| `src/components/UploadScriptsComponent.jsx` | `fontkit.create(fontBuffer)` (line 94) | `await parseFont(fontBuffer, file.name)` |
| `src/components/SingleUploaderTool.jsx` | `fontkit.create(Buffer.from(arrayBuffer))` (lines 196, 352) | `await parseFont(arrayBuffer, file.name)` |

**Total:** 9 call sites across 7 files.

### Property access refactoring

Every file that reads fontkit properties needs the access paths updated per the mapping table above. The heaviest files:

1. **`processFontFiles.js`** — ~25 property accesses across `extractFontMetadata`, `extractWeightName`, `handleWebfontMetadata`, `createFontObject`, `determineWeight`, `logFontInfo`
2. **`generateFontData.js`** — ~30 property accesses for metadata, metrics, features, characterSet, variationAxes
3. **`generateCssFile.js`** — ~8 accesses for variationAxes, OS/2, metrics
4. **`UploadScriptsComponent.jsx`** — ~15 accesses (largely duplicates processFontFiles logic)
5. **`getEmptyFontKit.js`** — ~6 accesses

### New shared utility: `src/utils/parseFont.js`

Create a shared wrapper that:
1. Handles the Promise wrapper around lib-font's event model
2. Ensures decompression libraries are loaded
3. Returns a consistent parsed font object

```js
// Shared font parser — wraps lib-font event model in a Promise
import { Font } from 'lib-font';

let decompressorsLoaded = false;

/** Ensure WOFF/WOFF2 decompression libraries are available */
async function ensureDecompressors() {
	if (decompressorsLoaded) return;
	if (!globalThis.pako) {
		const pako = await import('pako');
		globalThis.pako = pako;
	}
	if (!globalThis.unbrotli) {
		await import('lib-font/lib/unbrotli.js');
	}
	decompressorsLoaded = true;
}

/**
 * Parse a font file from an ArrayBuffer.
 * @param {ArrayBuffer} buffer - Raw font file bytes
 * @param {string} filename - Original filename (used for format detection)
 * @returns {Promise<Font>} Parsed lib-font Font object
 */
export async function parseFont(buffer, filename) {
	await ensureDecompressors();
	return new Promise((resolve, reject) => {
		const font = new Font('font');
		font.onload = (evt) => resolve(evt.detail.font);
		font.onerror = (evt) => reject(new Error(evt.detail?.message || `Failed to parse ${filename}`));
		font.fromDataBuffer(buffer, filename);
	});
}
```

### New shared utility: `src/utils/fontHelpers.js`

Extract common patterns that multiple files need:

```js
// Shared helpers for extracting data from lib-font parsed fonts

/**
 * Get a name table string by numeric name ID.
 * Returns empty string if not found.
 */
export function getNameString(font, nameID) {
	return font.opentype.tables.name?.get(nameID) || '';
}

/**
 * Get all feature tags from GSUB and GPOS tables.
 * Equivalent to fontkit's font.availableFeatures.
 */
export function getAllFeatureTags(font) {
	const tags = new Set();
	const tables = font.opentype.tables;
	for (const layoutTable of [tables.GSUB, tables.GPOS]) {
		if (!layoutTable) continue;
		try {
			for (const scriptTag of layoutTable.getSupportedScripts()) {
				const script = layoutTable.getScriptTable(scriptTag);
				for (const langTag of layoutTable.getSupportedLangSys(script)) {
					const langsys = layoutTable.getLangSysTable(script, langTag);
					for (const feature of layoutTable.getFeatures(langsys)) {
						tags.add(feature.featureTag.trim());
					}
				}
			}
		} catch (err) {
			console.warn(`Error reading ${layoutTable === tables.GSUB ? 'GSUB' : 'GPOS'} features:`, err.message);
		}
	}
	return [...tags];
}

/**
 * Get character set as array of code points.
 * Equivalent to fontkit's font.characterSet.
 */
export function getCharacterSet(font) {
	const cmap = font.opentype.tables.cmap;
	if (!cmap) return [];
	try {
		return cmap.getSupportedCharCodes(3, 1); // Windows Unicode BMP
	} catch {
		return [];
	}
}

/**
 * Build a variation axis map from fvar table.
 * Returns null if not a variable font.
 * @returns {VariationAxisMap|null}
 */
export function getVariationAxes(font) {
	const fvar = font.opentype.tables.fvar;
	if (!fvar) return null;
	const nameTable = font.opentype.tables.name;
	const axes = {};
	for (const axis of fvar.axes) {
		if (axis.minValue === axis.maxValue) continue; // Skip degenerate
		axes[axis.tag] = {
			min: axis.minValue,
			max: axis.maxValue,
			default: axis.defaultValue,
			name: nameTable?.get(axis.axisNameID) || axis.tag,
		};
	}
	return Object.keys(axes).length > 0 ? axes : null;
}

/**
 * Get named instances from fvar table.
 * @returns {Array<{ name: string, coordinates: number[] }>}
 */
export function getNamedInstances(font) {
	const fvar = font.opentype.tables.fvar;
	if (!fvar?.instances) return [];
	const nameTable = font.opentype.tables.name;
	return fvar.instances.map(inst => ({
		name: nameTable?.get(inst.subfamilyNameID) || '',
		coordinates: inst.coordinates,
		postScriptName: nameTable?.get(inst.postScriptNameID) || '',
	}));
}

/**
 * Build font metrics object matching the Sanity document shape.
 */
export function getFontMetrics(font) {
	const tables = font.opentype.tables;
	const os2 = tables['OS/2'];
	const head = tables.head;
	const post = tables.post;
	return {
		unitsPerEm: head?.unitsPerEm || 1000,
		ascender: os2?.sTypoAscender || 0,
		descender: os2?.sTypoDescender || 0,
		lineGap: os2?.sTypoLineGap || 0,
		underlinePosition: post?.underlinePosition || 0,
		underlineThickness: post?.underlineThickness || 0,
		italicAngle: post?.italicAngle || 0,
		capHeight: os2?.sCapHeight || 0,
		xHeight: os2?.sxHeight || 0,
		boundingBox: {
			xMin: head?.xMin || 0,
			yMin: head?.yMin || 0,
			xMax: head?.xMax || 0,
			yMax: head?.yMax || 0,
		},
	};
}

/**
 * Build font metadata object matching the Sanity document shape.
 */
export function getFontMetadata(font) {
	const name = font.opentype.tables.name;
	return {
		postscriptName: name?.get(6) || '',
		fullName: name?.get(4) || '',
		familyName: name?.get(1) || '',
		subfamilyName: name?.get(2) || '',
		copyright: name?.get(0) || '',
		version: name?.get(5) || '',
		genDate: new Date().toISOString(),
	};
}
```

---

## Webfont Name Patching

Currently `processFontFiles.js:handleWebfontMetadata()` patches woff/woff2 name records from a TTF companion by directly assigning `font.name.records = ttfFileData?.name?.records`. This is a fontkit internal mutation hack.

**lib-font approach:** lib-font's tables are lazy-parsed and read-only. Instead of patching the parsed font object, extract metadata from the TTF companion and use it as a fallback during the decision-building phase:

```js
// In buildUploadPlan or processFontFiles:
const webfontMeta = getFontMetadata(webfontParsed);
const hasMissingNames = !webfontMeta.fullName || !webfontMeta.familyName;

if (hasMissingNames && ttfCompanion) {
	const ttfMeta = getFontMetadata(ttfCompanion);
	// Use TTF metadata as fallback, not mutation
	fontEntry.title = ttfMeta.fullName || webfontMeta.fullName || filename;
	// ... etc for other fields
}
```

This is cleaner, more predictable, and doesn't rely on mutable internals.

---

## Buffer Dependency Removal

fontkit requires `Buffer` (Node.js polyfill). lib-font uses `DataView` on `ArrayBuffer` natively — no Buffer polyfill needed. This removes the `buffer` dependency (~50 KB) from the bundle.

Remove from `package.json`:
```diff
- "buffer": "^6.0.3",
```

Remove from `SingleUploaderTool.jsx`:
```diff
- import { Buffer } from 'buffer';
```

All `Buffer.from(arrayBuffer)` calls become unnecessary — pass the `ArrayBuffer` directly to `parseFont()`.

---

## Known Gaps

### STAT table is a stub
lib-font 3.0.1 has a STAT table class but it parses no fields. If STAT data is needed:
- **Option A:** Write a custom STAT parser (~100 lines) that reads from the raw font buffer using offsets from `font.opentype.directory`
- **Option B:** Skip STAT for v3.0 and add it when lib-font implements it (tracked in their issues)
- **Recommendation:** Option B. STAT is informational-only in our use case (axis value names). The review UI can show axis tags without STAT descriptors.

### ESM only
lib-font has no CJS build. Since the plugin builds with tsup (ESM + CJS output), lib-font will be bundled into the CJS output by tsup. This works because tsup inlines ESM imports into CJS output. No action needed beyond ensuring tsup handles it correctly.

### Decompression library loading
pako (~50 KB) and unbrotli (~200 KB) must be available at parse time. Options:
1. **Bundle them** (recommended) — import in `parseFont.js`, tree-shaken into the build
2. **Lazy load from CDN** — fragile, depends on network
3. **Include as peer deps** — consumers must install them

Recommendation: Bundle pako and unbrotli into the plugin. The ~250 KB combined is acceptable given we're removing fontkit (~200 KB) and buffer (~50 KB) — net bundle impact is near-zero.

---

## Migration Order

### Phase 0: Infrastructure (do first)
1. `npm install lib-font pako` (unbrotli comes with lib-font)
2. `npm uninstall fontkit buffer`
3. Create `src/utils/parseFont.js`
4. Create `src/utils/fontHelpers.js`
5. Update `tsup.config.ts` to handle ESM-only lib-font
6. Verify build works with empty helpers

### Phase 1: Core utils (highest impact, most property accesses)
1. `processFontFiles.js` — convert all 25+ property accesses, make `processFontFiles` async
2. `generateFontData.js` — convert all 30 accesses, make async
3. `generateCssFile.js` — convert 8 accesses, make async

### Phase 2: Supporting utils
4. `getEmptyFontKit.js` → rename to `getEmptyFont.js`, convert 6 accesses
5. `regenerateFontData.js` — update to use new async parseFont

### Phase 3: Components
6. `UploadScriptsComponent.jsx` — convert 15 accesses
7. `SingleUploaderTool.jsx` — update 2 call sites, remove Buffer import

### Phase 4: Tests
8. Update all mock font objects to match lib-font shapes
9. Add integration test with a real small font file parsed through lib-font
10. Run full test suite, fix any regressions

---

## Test Impact

All existing fontkit mock objects in tests must be reshaped to match lib-font's table structure:

**Before (fontkit mock):**
```js
const mockFont = {
	fullName: 'MyFont Bold',
	familyName: 'MyFont',
	italicAngle: 0,
	'OS/2': { usWeightClass: 700 },
	name: { records: { preferredSubfamily: 'Bold' } },
	variationAxes: null,
};
```

**After (lib-font mock):**
```js
const mockFont = {
	opentype: {
		tables: {
			name: {
				get: (id) => ({
					4: 'MyFont Bold',    // fullName
					1: 'MyFont',         // familyName
					2: 'Bold',           // subfamilyName
					6: 'MyFont-Bold',    // postscriptName
					16: null,            // preferredFamily
					17: 'Bold',          // preferredSubfamily
				})[id] || '',
			},
			'OS/2': { usWeightClass: 700, fsSelection: 0x40 },
			head: { macStyle: 0, unitsPerEm: 1000 },
			post: { italicAngle: 0 },
			fvar: null,
			maxp: { numGlyphs: 500 },
			GSUB: null,
			GPOS: null,
			cmap: { getSupportedCharCodes: () => [] },
		},
	},
};
```

Create a `mockLibFont(overrides)` factory in `src/tests/fixtures/` to reduce test boilerplate.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| lib-font name.get() returns different value than fontkit for same font | Medium | High — title/ID derivation breaks | Test with real font corpus (5-10 production fonts from Darden/TDF/MCKL) before merging |
| WOFF2 decompression fails in Sanity Studio | Low | High — blocks uploads | Bundle unbrotli.js; fallback to error message if decompression unavailable |
| lib-font parse failure on font that fontkit handles | Medium | Medium — individual font fails | Compare parse success rate on test corpus; file issues upstream if gaps found |
| Async parseFont changes call graph | Certain | Low — mechanical change | All callers already need to be async for the upload modal overhaul |
| STAT table data unavailable | Certain | Low — informational only | STAT is not used in current code; axis display falls back to tag strings |
| lib-font maintenance drops | Low | Medium | lib-font is simpler than fontkit — we could fork and maintain the subset we use |
| Decompressor globals not set before lib-font module evaluates | High | High — WOFF/WOFF2 silently fails | See C1 below — must set globals before importing lib-font |
| lib-font shim-fetch mutates globalThis.fetch | Medium | Medium — breaks SSR/Node 18+ | Use `skipStyleSheet: true` option; investigate if shim can be bypassed |
| name.get() returns non-English record for CJK fonts | Medium | High — wrong title/weight strings | Use explicit platform/encoding/language lookup helper, not bare name.get() |

---

## Review Amendments (panel review 2026-05-29)

34 findings from 7-engineer panel review (Performance, Security, API Design, Bundle/Build, Font/VF, Test Coverage, Architecture).

### Critical — must resolve before implementation

#### C1: Decompressor globals must be set BEFORE lib-font module evaluates
lib-font reads `globalThis.pako` and `globalThis.unbrotli` at **module evaluation time** (top of woff.js/woff2.js), not at parse time. Dynamic `import()` is always async — by the time it resolves, lib-font has already cached `undefined` for the decompressors.

**Resolution:** Set globals synchronously before importing lib-font. Options:
- **Option A (recommended):** Import pako and unbrotli as regular (non-dynamic) imports in `parseFont.js`, and set globals at module top level before lib-font is imported:
  ```js
  import pako from 'pako';
  import unbrotli from './vendor/unbrotli.js'; // vendored copy
  globalThis.pako = pako;
  globalThis.unbrotli = unbrotli;
  // AFTER globals are set:
  import { Font } from 'lib-font';
  ```
  Note: static import order is guaranteed in ESM — top-level side effects execute in declaration order. But `lib-font` may be hoisted. Safest approach is a separate bootstrap module.
- **Option B:** Use a bootstrap script that sets globals and dynamically imports both lib-font and the plugin:
  ```js
  // bootstrap.js — imported first
  import pako from 'pako';
  globalThis.pako = pako;
  // unbrotli must be loaded as side-effect script (sets globalThis.unbrotli on eval)
  await import('./vendor/unbrotli.js');
  const { Font } = await import('lib-font');
  export { Font };
  ```

#### C2: `lib-font/lib/unbrotli.js` subpath not in exports map
lib-font's `package.json` exports only `"./lib-font.js"`. The `lib/unbrotli.js` subpath is blocked by Node's export map enforcement.

**Resolution:** Vendor the unbrotli.js file into `src/vendor/unbrotli.js` and import from there. Do not rely on lib-font's internal paths.

#### C3: lib-font contains `import("zlib")` and `import("fs")` in WOFF/WOFF2 constructors
These are Node.js-only fallbacks that tsup/esbuild will try to inline into the CJS bundle, producing broken code for browser environments.

**Resolution:** Add `"zlib"` and `"fs"` to tsup's `external` array. lib-font's browser code paths don't actually reach them (they're behind `globalThis.pako`/`unbrotli` checks), but esbuild needs to know not to bundle them.

#### C4: Metric source ambiguity (ascent/descent/lineGap)
fontkit resolves metrics from a priority chain (OS/2 typo → hhea → OS/2 win). lib-font exposes all three raw. Switching sources changes CSS `@font-face` metric overrides, affecting CLS.

**Resolution:** Use OS/2 typo metrics (`sTypoAscender`, `sTypoDescender`, `sTypoLineGap`) as primary when `fsSelection` bit 7 (USE_TYPO_METRICS) is set. Fall back to `hhea.ascender`/`hhea.descender` when bit 7 is unset. Document this decision in `getFontMetrics`:
```js
const useTypo = (os2.fsSelection & 0x80) !== 0;
return {
    ascender: useTypo ? os2.sTypoAscender : (tables.hhea?.ascender ?? os2.sTypoAscender),
    descender: useTypo ? os2.sTypoDescender : (tables.hhea?.descender ?? os2.sTypoDescender),
    lineGap: useTypo ? os2.sTypoLineGap : (tables.hhea?.lineGap ?? os2.sTypoLineGap),
};
```

#### C5: `variationAxes` shape change (object → array)
Every consumer iterates with `Object.keys(font.variationAxes)`. lib-font returns `fvar.axes` as an array with `{ tag, minValue, defaultValue, maxValue }`.

**Resolution:** `getVariationAxes()` in fontHelpers already converts to a keyed map (`{ wght: { min, max, default } }`). All callers must use `getVariationAxes()` exclusively — no direct `fvar.axes` access.

#### C6: `namedVariations` has no equivalent
fontkit synthesizes `{ 'Light': { wght: 300 } }`. lib-font requires manual `fvar.instances` → `name.get(subfamilyNameID)` mapping.

**Resolution:** `getNamedInstances()` in fontHelpers handles this. Callers must use it exclusively. The existing fallback path in `generateFontData.js` (lines 72-94) must be rewritten against the new shape.

#### C7: `name.get()` platform/encoding/language ambiguity
`name.get(nameID)` returns the first matching record. For CJK fonts, this may be a non-English record.

**Resolution:** Replace the spec's `getNameString(font, nameID)` with a helper that explicitly prefers Windows/Unicode/English:
```js
function getNameString(font, nameID) {
    const records = font.opentype.tables.name?.nameRecords || [];
    // Prefer Windows Unicode English
    const win = records.find(r => r.nameID === nameID && r.platformID === 3 && r.languageID === 0x0409);
    if (win?.string) return win.string;
    // Fallback: Mac Roman English
    const mac = records.find(r => r.nameID === nameID && r.platformID === 1 && r.languageID === 0);
    if (mac?.string) return mac.string;
    // Last resort: first record with this nameID
    const any = records.find(r => r.nameID === nameID);
    return any?.string || '';
}
```

#### C8: Bundle size math is wrong
fontkit unpacked is 5.6MB (not 200KB — that was a post-bundle estimate). pako unpacked is 1.6MB. The "net-zero" claim needs actual `--metafile` bundle analysis.

**Resolution:** Run `tsup --metafile` before and after migration. Document actual bundle sizes. The claim is removed from the spec.

#### C9: lib-font's shim-fetch mutates globalThis.fetch
`lib-font/src/utils/shim-fetch.js` unconditionally rewrites `globalThis.fetch` if it detects Node.js. This breaks SSR and Node 18+ native fetch.

**Resolution:** Investigate whether `new Font("font", { skipStyleSheet: true })` prevents the shim from running. If not, consider patching or forking lib-font's entry point to skip the fetch shim. Add to tsup `external` if needed.

#### C10: handleWebfontMetadata mutation incompatible with read-only tables
`font.name.records = ttfFileData?.name?.records` will silently fail on lib-font's immutable table objects.

**Resolution:** Already addressed in spec (fallback-during-decision pattern). Ensure Phase 1 migration of `processFontFiles.js` includes this change — it cannot be deferred.

### Major — resolve during implementation

#### M1: Consolidate metadata extraction — eliminate duplication
Three parallel paths exist: `buildFontMetadata` (generateFontData.js), `getFontMetadata`/`getFontMetrics` (fontHelpers), and inline extraction in `UploadScriptsComponent`.

**Resolution:** Delete `buildFontMetadata`. `generateFontData.js` calls `getFontMetadata()` and `getFontMetrics()` from fontHelpers. `UploadScriptsComponent` also calls fontHelpers exclusively. One path, one source of truth.

#### M2: Add abstraction layer between lib-font and business logic
fontHelpers should be the ONLY code that touches `font.opentype.tables.*`. All other code receives plain objects from fontHelpers. If lib-font's API changes, only fontHelpers needs updating.

**Resolution:** Export a `parseFontToSnapshot(buffer, filename)` function that calls `parseFont` then all fontHelpers extractors and returns a single `FontSnapshot` plain object. Callers never see the lib-font Font instance.

#### M3: generateCssFile double-parse must be eliminated
Both `calcFallbackData` and the main function call `fontkit.create` on the same buffer.

**Resolution:** Refactor `generateCssFile` to accept a pre-parsed font object (or FontSnapshot) instead of a raw buffer. The caller (uploadFontFiles) parses once and passes the result.

#### M4: Cache name.get() results
6-12 linear scans of nameRecords per font is wasteful.

**Resolution:** `getNameString` should build a lookup map on first call for a given font, then return cached values:
```js
const nameCache = new WeakMap();
function getNameString(font, nameID) {
    if (!nameCache.has(font)) nameCache.set(font, {});
    const cache = nameCache.get(font);
    if (nameID in cache) return cache[nameID];
    // ... lookup logic ...
    cache[nameID] = result;
    return result;
}
```

#### M5: Phase ordering — migrate all files atomically
Migrating processFontFiles in Phase 1 while leaving regenerateFontData on fontkit in Phase 2 creates a mismatch window where `extractFontMetadata` expects lib-font but receives fontkit objects.

**Resolution:** Move regenerateFontData to Phase 1. All files that call `extractFontMetadata` must migrate together.

#### M6: getCharacterSet/getAllFeatureTags wrapping and caching
`getCharacterSet` returns bare array but Sanity stores `{ chars: [...] }`. `getAllFeatureTags` has same issue.

**Resolution:** These helpers return raw arrays. The wrapping in `{ chars: [...] }` is the caller's responsibility (in `generateFontData`). Document this explicitly. Cache `getAllFeatureTags` result since the traversal is expensive.

#### M7: CSS font-family injection risk
Font name strings interpolated directly into CSS without escaping.

**Resolution:** Add `escapeCssFontName(name)` helper that escapes quotes and special characters before interpolation into `@font-face` blocks. Apply in `generateCssFile.js`.

#### M8: ArrayBuffer size validation
No upper bound on input file size before decompression/parsing.

**Resolution:** Add a `MAX_FONT_FILE_SIZE` constant (e.g., 50MB) in parseFont.js. Reject with descriptive error before parsing.

### Minor — address during polish

- **m1:** `font.capHeight`/`xHeight` need OS/2 version ≥ 2 guard
- **m2:** pako in node_modules is v0.2.9 — upgrade to v2.x for `pako.inflate` API
- **m3:** Rename `getEmptyFontKit.js` to `buildFontNameGroups.js` (descriptive of what it actually does)
- **m4:** Remove `logFontInfo` console.log of full font objects — or strip to name-only in production
- **m5:** Module-level decompressor flag incompatible with Worker lifecycle — use the bootstrap pattern from C1 instead
- **m6:** Rename `fontKit` parameter to `parsedFont` across all call sites
- **m7:** Add parseFont.js test file with: success, WOFF2 decompression, corrupt file rejection, oversized file rejection
- **m8:** Capture fontkit output baseline (snapshot test) for 5 production fonts before migration, compare against lib-font output
- **m9:** Add tests for `getCharacterSet`, `getAllFeatureTags`, `handleWebfontMetadata` fallback path
- **m10:** Add negative test: unawaited parseFont returns Promise, not font object
