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
 * Get all OpenType feature tags from GSUB and GPOS tables.
 * Traverses scripts → langsys → features, deduplicates, and caches.
 * Equivalent to fontkit's font.availableFeatures.
 *
 * @param {object} font - lib-font Font instance
 * @returns {string[]} Array of unique 4-character feature tag strings (e.g. ['kern', 'liga', 'smcp'])
 */
export function getAllFeatureTags(font) {
	const tags = new Set();
	const tables = font.opentype?.tables;
	for (const layoutTable of [tables?.GSUB, tables?.GPOS]) {
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
