// Shared helpers for extracting data from lib-font parsed fonts — the ONLY code that touches font.opentype.tables.*

/**
 * Name record lookup cache — avoids repeated linear scans of nameRecords.
 * Keyed by font instance (WeakMap), values are { [nameID]: string } maps.
 * @type {WeakMap<object, Object.<number, string>>}
 */
const nameCache = new WeakMap();

/**
 * Get a name table string by numeric name ID.
 * Prefers Windows/Unicode/English (platform 3, language 0x0409),
 * falls back to Mac/Roman/English (platform 1, language 0),
 * then first available record.
 *
 * @param {object} font - lib-font Font instance
 * @param {number} nameID - OpenType name ID (0=copyright, 1=family, 2=subfamily, 4=fullName, 6=postscript, 16=prefFamily, 17=prefSubfamily)
 * @returns {string} Decoded name string, or empty string if not found
 */
export function getNameString(font, nameID) {
	if (!nameCache.has(font)) nameCache.set(font, {});
	const cache = nameCache.get(font);
	if (nameID in cache) return cache[nameID];

	const records = font.opentype?.tables?.name?.nameRecords || [];

	// Priority 1: Windows Unicode English
	const win = records.find(r => r.nameID === nameID && r.platformID === 3 && r.languageID === 0x0409);
	if (win?.string) { cache[nameID] = win.string; return win.string; }

	// Priority 2: Mac Roman English
	const mac = records.find(r => r.nameID === nameID && r.platformID === 1 && r.languageID === 0);
	if (mac?.string) { cache[nameID] = mac.string; return mac.string; }

	// Priority 3: First record with this nameID
	const any = records.find(r => r.nameID === nameID);
	const result = any?.string || '';
	cache[nameID] = result;
	return result;
}

/**
 * Tags whose FeatureParams can carry a foundry-authored UI label — stylistic sets (ss01–ss20) and
 * character variants (cv01–cv99). No other feature tag has a name in the OpenType spec.
 * @type {RegExp}
 */
const UI_LABELLED_TAG = /^(ss|cv)\d\d$/;

/**
 * Lowest name table ID a feature label may use. IDs 0–255 are reserved for the standard records
 * (copyright, family, subfamily…), so FeatureParams pointing below this is a malformed font rather
 * than a label — honouring it would title a stylistic set with the font's copyright string.
 * @type {number}
 */
const FIRST_CUSTOM_NAME_ID = 256;

/**
 * Walks every feature table in GSUB and GPOS, calling `visit` with the table and its trimmed tag.
 *
 * Shared by `getAllFeatureTags` and `getFeatureUiNames` so the scripts → langsys → features
 * traversal and its per-table error handling exist once. Fonts repeat the same feature across
 * scripts and languages, so `visit` sees most tags many times over — callers deduplicate.
 *
 * @param {object} font - lib-font Font instance
 * @param {(feature: object, tag: string) => void} visit - called for every feature table found
 * @returns {void}
 */
function eachFeatureTable(font, visit) {
	const tables = font.opentype?.tables;
	for (const layoutTable of [tables?.GSUB, tables?.GPOS]) {
		if (!layoutTable) continue;
		try {
			for (const scriptTag of layoutTable.getSupportedScripts()) {
				const script = layoutTable.getScriptTable(scriptTag);
				for (const langTag of layoutTable.getSupportedLangSys(script)) {
					const langsys = layoutTable.getLangSysTable(script, langTag);
					for (const feature of layoutTable.getFeatures(langsys)) {
						if (!feature?.featureTag) continue;
						visit(feature, feature.featureTag.trim());
					}
				}
			}
		} catch (err) {
			console.warn(`Error reading ${layoutTable === tables.GSUB ? 'GSUB' : 'GPOS'} features:`, err.message);
		}
	}
}

/**
 * Get all OpenType feature tags from GSUB and GPOS tables.
 * Traverses scripts → langsys → features, deduplicates, and caches.
 * Equivalent to fontkit's font.availableFeatures.
 *
 * @param {object} font - lib-font Font instance
 * @returns {string[]} Array of unique 4-character feature tag strings (e.g. ['kern', 'liga', 'smcp'])
 */
export function getAllFeatureTags(font) {
	const tags = new Set();
	eachFeatureTable(font, (_feature, tag) => {
		if (tag) tags.add(tag);
	});
	return [...tags];
}

/**
 * Reads the foundry-authored UI labels for the font's stylistic sets and character variants.
 *
 * These are the only features a type designer gets to name: `ss01` might be "Alternate g" in one
 * family and "Flat-topped 3" in the next, so the generic "Stylistic Set 1" is the wrong label
 * whenever the font ships a real one. The label lives in the feature's FeatureParams as a name
 * table ID, which lib-font resolves through `getFeatureParams()`.
 *
 * Unnamed features are omitted rather than returned with an empty title, so callers can fall back
 * to their own canonical titles without having to filter blanks first.
 *
 * @param {object} font - lib-font Font instance
 * @returns {{tag: string, title: string}[]} labelled features sorted by tag, ready for the
 *   `font.opentypeFeatures.featureList` field, e.g. [{ tag: 'ss01', title: 'Alternate g' }]
 */
export function getFeatureUiNames(font) {
	const names = new Map();

	eachFeatureTable(font, (feature, tag) => {
		// The same tag recurs across scripts and languages — the first label found wins.
		if (!UI_LABELLED_TAG.test(tag) || names.has(tag)) return;

		const nameID = readUiLabelNameId(feature, tag);
		if (!nameID) return;

		const title = getNameString(font, nameID).trim();
		if (title) names.set(tag, title);
	});

	return [...names.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([tag, title]) => ({ tag, title }));
}

/**
 * Resolves a feature table's UI label name ID, or 0 when it has none.
 *
 * `getFeatureParams()` re-reads the font at a stored offset, so a malformed table throws here
 * instead of returning null — caught per feature, because one bad stylistic set must not cost us
 * the labels on all the others.
 *
 * @param {object} feature - lib-font FeatureTable
 * @param {string} tag - the feature's trimmed 4-character tag, already known to be ssXX or cvXX
 * @returns {number} name table ID in the custom range (256+), or 0 when unavailable
 */
function readUiLabelNameId(feature, tag) {
	if (typeof feature.getFeatureParams !== 'function') return 0;

	let params;
	try {
		params = feature.getFeatureParams();
	} catch (err) {
		console.warn(`Error reading FeatureParams for ${tag}:`, err.message);
		return 0;
	}
	if (!params) return 0;

	// Stylistic sets expose the label as `UINameID`; character variants call it `featUiLabelNameId`.
	const nameID = tag.startsWith('ss') ? params.UINameID : params.featUiLabelNameId;
	return Number.isInteger(nameID) && nameID >= FIRST_CUSTOM_NAME_ID ? nameID : 0;
}

/**
 * Get character set as array of code points from the cmap table.
 * Uses Windows/Unicode BMP subtable (platform 3, encoding 1).
 *
 * @param {object} font - lib-font Font instance
 * @returns {number[]} Array of supported Unicode code points
 */
export function getCharacterSet(font) {
	const cmap = font.opentype?.tables?.cmap;
	if (!cmap) return [];
	try {
		const raw = cmap.getSupportedCharCodes(3, 1);
		if (!Array.isArray(raw) || raw.length === 0) return [];
		// getSupportedCharCodes may return range objects { start, end } — expand to individual codepoints
		if (typeof raw[0] === 'object' && raw[0].start !== undefined) {
			const codes = [];
			for (const range of raw) {
				for (let i = range.start; i <= range.end; i++) {
					codes.push(i);
				}
			}
			return codes;
		}
		return raw;
	} catch {
		return [];
	}
}

/**
 * Build a variation axis map from fvar table.
 * Filters out degenerate axes (min === max). Returns null if not a variable font.
 *
 * @param {object} font - lib-font Font instance
 * @returns {{ [tag: string]: { min: number, max: number, default: number, name: string } } | null}
 */
export function getVariationAxes(font) {
	const fvar = font.opentype?.tables?.fvar;
	if (!fvar?.axes) return null;

	const axes = {};
	for (const axis of fvar.axes) {
		if (axis.minValue === axis.maxValue) continue;
		axes[axis.tag] = {
			min: axis.minValue,
			max: axis.maxValue,
			default: axis.defaultValue,
			name: getNameString(font, axis.axisNameID) || axis.tag,
		};
	}
	return Object.keys(axes).length > 0 ? axes : null;
}

/**
 * Get named instances from fvar table.
 * Resolves subfamilyNameID and postScriptNameID via the name table.
 *
 * @param {object} font - lib-font Font instance
 * @returns {Array<{ name: string, coordinates: number[], postScriptName: string }>}
 */
export function getNamedInstances(font) {
	const fvar = font.opentype?.tables?.fvar;
	if (!fvar?.instances) return [];
	return fvar.instances.map(inst => ({
		name: getNameString(font, inst.subfamilyNameID),
		coordinates: inst.coordinates,
		postScriptName: getNameString(font, inst.postScriptNameID || 0),
	}));
}

/**
 * Build font metrics object matching the Sanity document shape.
 * Uses OS/2 typo metrics when USE_TYPO_METRICS bit is set, otherwise hhea.
 *
 * @param {object} font - lib-font Font instance
 * @returns {{ unitsPerEm: number, ascender: number, descender: number, lineGap: number, underlinePosition: number, underlineThickness: number, italicAngle: number, capHeight: number, xHeight: number, boundingBox: { xMin: number, yMin: number, xMax: number, yMax: number } }}
 */
export function getFontMetrics(font) {
	const tables = font.opentype?.tables;
	const os2 = tables?.['OS/2'];
	const head = tables?.head;
	const post = tables?.post;
	const hhea = tables?.hhea;

	// USE_TYPO_METRICS flag (fsSelection bit 7) — when set, use OS/2 typo metrics
	const useTypo = os2 ? (os2.fsSelection & 0x80) !== 0 : false;

	return {
		unitsPerEm: head?.unitsPerEm || 1000,
		ascender: useTypo ? (os2?.sTypoAscender || 0) : (hhea?.ascender ?? os2?.sTypoAscender ?? 0),
		descender: useTypo ? (os2?.sTypoDescender || 0) : (hhea?.descender ?? os2?.sTypoDescender ?? 0),
		lineGap: useTypo ? (os2?.sTypoLineGap || 0) : (hhea?.lineGap ?? os2?.sTypoLineGap ?? 0),
		underlinePosition: post?.underlinePosition || 0,
		underlineThickness: post?.underlineThickness || 0,
		italicAngle: post?.italicAngle || 0,
		capHeight: (os2?.version >= 2) ? (os2?.sCapHeight || 0) : 0,
		xHeight: (os2?.version >= 2) ? (os2?.sxHeight || 0) : 0,
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
 *
 * @param {object} font - lib-font Font instance
 * @returns {{ postscriptName: string, fullName: string, familyName: string, subfamilyName: string, copyright: string, version: string, genDate: string }}
 */
export function getFontMetadata(font) {
	return {
		postscriptName: getNameString(font, 6),
		fullName: getNameString(font, 4),
		familyName: getNameString(font, 1),
		subfamilyName: getNameString(font, 2),
		preferredFamily: getNameString(font, 16),
		preferredSubfamily: getNameString(font, 17),
		copyright: getNameString(font, 0),
		version: getNameString(font, 5),
		genDate: new Date().toISOString(),
	};
}

/**
 * Get the OS/2 usWeightClass value.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number|null} Weight class (1-1000) or null if OS/2 table is missing
 */
export function getWeightClass(font) {
	return font.opentype?.tables?.['OS/2']?.usWeightClass || null;
}

/**
 * Get the OS/2 fsSelection flags as a raw uint16.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number} fsSelection bitmask (0 if OS/2 table is missing)
 */
export function getFsSelection(font) {
	return font.opentype?.tables?.['OS/2']?.fsSelection || 0;
}

/**
 * Get the head macStyle flags as a uint16 bitmask.
 * lib-font returns macStyle as a bit array (big-endian order: index 15 = bit 0).
 * This helper converts it back to a standard uint16 for bitwise testing.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number} macStyle bitmask (0 if head table is missing)
 */
export function getMacStyle(font) {
	const macStyle = font.opentype?.tables?.head?.macStyle;
	if (!macStyle) return 0;
	// lib-font returns a bit array or a number depending on version
	if (typeof macStyle === 'number') return macStyle;
	// Convert bit array (big-endian) to uint16: index 15 = bit 0, index 14 = bit 1, etc.
	if (typeof macStyle === 'object') {
		let value = 0;
		for (let i = 0; i < 16; i++) {
			if (macStyle[i]) value |= (1 << (15 - i));
		}
		return value;
	}
	return 0;
}

/**
 * Get the post table italic angle.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number} Italic angle in degrees (0 for upright fonts)
 */
export function getItalicAngle(font) {
	return font.opentype?.tables?.post?.italicAngle || 0;
}

/**
 * Get glyph count from maxp table.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number} Number of glyphs
 */
export function getGlyphCount(font) {
	return font.opentype?.tables?.maxp?.numGlyphs || 0;
}

/**
 * Get the OS/2 sFamilyClass value for font category detection.
 *
 * @param {object} font - lib-font Font instance
 * @returns {number} sFamilyClass value (0 if missing)
 */
export function getFamilyClass(font) {
	return font.opentype?.tables?.['OS/2']?.sFamilyClass || 0;
}

/**
 * Escape a font name for safe interpolation into CSS font-family declarations.
 * Prevents CSS injection via crafted name table strings.
 *
 * @param {string} name - Raw font name from the name table
 * @returns {string} Escaped name safe for CSS string context
 */
export function escapeCssFontName(name) {
	return name.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/;/g, '');
}
