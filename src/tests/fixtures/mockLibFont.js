// Mock lib-font Font factory for tests — mirrors the font.opentype.tables.* structure

/**
 * Creates a mock lib-font Font object with sensible defaults.
 * Override any table or field via the overrides parameter.
 *
 * @param {object} [overrides] - Partial overrides merged into the mock
 * @param {object} [overrides.name] - Map of nameID → string values
 * @param {object} [overrides.os2] - OS/2 table field overrides
 * @param {object} [overrides.head] - head table field overrides
 * @param {object} [overrides.post] - post table field overrides
 * @param {object} [overrides.fvar] - fvar table override (null for non-VF)
 * @param {object} [overrides.maxp] - maxp table field overrides
 * @param {object} [overrides.GSUB] - GSUB table override (null to disable)
 * @param {object} [overrides.GPOS] - GPOS table override (null to disable)
 * @param {object} [overrides.cmap] - cmap table override
 * @param {object} [overrides.hhea] - hhea table field overrides
 * @returns {object} Mock lib-font Font object
 */
export function mockLibFont(overrides = {}) {
	const nameMap = {
		0: 'Copyright 2024 Test Foundry',
		1: 'MyFont',
		2: 'Regular',
		4: 'MyFont Regular',
		5: 'Version 1.000',
		6: 'MyFont-Regular',
		16: null,
		17: null,
		...(overrides.name || {}),
	};

	// Build nameRecords array from the name map for platform-aware lookups
	const nameRecords = Object.entries(nameMap)
		.filter(([, v]) => v != null)
		.map(([id, string]) => ({
			nameID: parseInt(id, 10),
			platformID: 3,
			encodingID: 1,
			languageID: 0x0409,
			string,
		}));

	return {
		opentype: {
			tables: {
				name: {
					get: (id) => nameMap[id] || '',
					nameRecords,
					...(overrides.nameTable || {}),
				},
				'OS/2': {
					usWeightClass: 400,
					fsSelection: 0x40, // REGULAR bit
					sFamilyClass: 0,
					sTypoAscender: 800,
					sTypoDescender: -200,
					sTypoLineGap: 0,
					sCapHeight: 700,
					sxHeight: 500,
					version: 4,
					...(overrides.os2 || {}),
				},
				head: {
					unitsPerEm: 1000,
					macStyle: 0,
					xMin: 0,
					yMin: -200,
					xMax: 1000,
					yMax: 800,
					...(overrides.head || {}),
				},
				post: {
					italicAngle: 0,
					underlinePosition: -100,
					underlineThickness: 50,
					...(overrides.post || {}),
				},
				hhea: {
					ascender: 800,
					descender: -200,
					lineGap: 0,
					...(overrides.hhea || {}),
				},
				fvar: overrides.fvar !== undefined ? overrides.fvar : null,
				STAT: null,
				maxp: {
					numGlyphs: 500,
					...(overrides.maxp || {}),
				},
				GSUB: overrides.GSUB !== undefined ? overrides.GSUB : null,
				GPOS: overrides.GPOS !== undefined ? overrides.GPOS : null,
				cmap: {
					supports: () => false,
					getGlyphId: () => 0,
					getSupportedCharCodes: () => [],
					getSupportedEncodings: () => [],
					...(overrides.cmap || {}),
				},
			},
		},
	};
}

/**
 * Creates a mock variable font with standard wght + ital axes.
 *
 * @param {object} [overrides] - Additional overrides passed to mockLibFont
 * @returns {object} Mock lib-font Font object with fvar table
 */
export function mockVariableFont(overrides = {}) {
	return mockLibFont({
		name: {
			4: 'MyFont VF',
			6: 'MyFont-VF',
			...(overrides.name || {}),
		},
		fvar: {
			axes: [
				{ tag: 'wght', minValue: 100, maxValue: 900, defaultValue: 400, flags: 0, axisNameID: 256 },
				{ tag: 'ital', minValue: 0, maxValue: 1, defaultValue: 0, flags: 0, axisNameID: 257 },
			],
			instances: [
				{ subfamilyNameID: 258, coordinates: [400, 0], postScriptNameID: 0 },
				{ subfamilyNameID: 259, coordinates: [700, 0], postScriptNameID: 0 },
			],
			getSupportedAxes: () => ['wght', 'ital'],
			getAxis: (tag) => ({ wght: { tag: 'wght', minValue: 100, maxValue: 900, defaultValue: 400 }, ital: { tag: 'ital', minValue: 0, maxValue: 1, defaultValue: 0 } })[tag],
			...(overrides.fvar || {}),
		},
		...overrides,
	});
}

/**
 * Creates a mock bold italic font.
 *
 * @param {object} [overrides] - Additional overrides
 * @returns {object} Mock lib-font Font object
 */
export function mockBoldItalicFont(overrides = {}) {
	return mockLibFont({
		name: {
			1: 'MyFont',
			2: 'Bold Italic',
			4: 'MyFont Bold Italic',
			6: 'MyFont-BoldItalic',
			17: 'Bold Italic',
			...(overrides.name || {}),
		},
		os2: {
			usWeightClass: 700,
			fsSelection: 0x21, // ITALIC + BOLD bits
			...(overrides.os2 || {}),
		},
		head: {
			macStyle: 0x03, // BOLD + ITALIC
			...(overrides.head || {}),
		},
		post: {
			italicAngle: -12,
			...(overrides.post || {}),
		},
		...overrides,
	});
}
