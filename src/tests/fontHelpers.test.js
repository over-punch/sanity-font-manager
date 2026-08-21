// Tests for fontHelpers — lib-font extraction utilities
import { describe, it, expect } from 'vitest';
import {
	getNameString,
	getAllFeatureTags,
	getFeatureUiNames,
	getCharacterSet,
	getVariationAxes,
	getNamedInstances,
	getFontMetrics,
	getFontMetadata,
	getWeightClass,
	getFsSelection,
	getMacStyle,
	getItalicAngle,
	getGlyphCount,
	getFamilyClass,
	escapeCssFontName,
} from '../utils/fontHelpers';
import { mockLibFont, mockVariableFont, mockBoldItalicFont, mockLayoutTable } from './fixtures/mockLibFont';

// ---------------------------------------------------------------------------
// getNameString
// ---------------------------------------------------------------------------

describe('getNameString', () => {
	it('returns name by numeric ID', () => {
		const font = mockLibFont();
		expect(getNameString(font, 4)).toBe('MyFont Regular');
		expect(getNameString(font, 1)).toBe('MyFont');
		expect(getNameString(font, 6)).toBe('MyFont-Regular');
	});

	it('returns empty string for missing name ID', () => {
		const font = mockLibFont();
		expect(getNameString(font, 99)).toBe('');
	});

	it('returns empty string for null name value', () => {
		const font = mockLibFont({ name: { 16: null } });
		expect(getNameString(font, 16)).toBe('');
	});

	it('caches results across repeated calls', () => {
		const font = mockLibFont();
		const first = getNameString(font, 4);
		const second = getNameString(font, 4);
		expect(first).toBe(second);
	});

	it('prefers Windows Unicode English (platformID 3, languageID 0x0409)', () => {
		const font = mockLibFont();
		// Default mock uses platformID 3, languageID 0x0409
		expect(getNameString(font, 1)).toBe('MyFont');
	});

	it('falls back to Mac record when Windows record is missing', () => {
		const font = mockLibFont();
		// Add a Mac-only record for nameID 99
		font.opentype.tables.name.nameRecords.push({
			nameID: 99,
			platformID: 1,
			encodingID: 0,
			languageID: 0,
			string: 'Mac Only Name',
		});
		expect(getNameString(font, 99)).toBe('Mac Only Name');
	});
});

// ---------------------------------------------------------------------------
// getFontMetadata
// ---------------------------------------------------------------------------

describe('getFontMetadata', () => {
	it('builds metadata from name table IDs', () => {
		const font = mockLibFont();
		const meta = getFontMetadata(font);
		expect(meta.postscriptName).toBe('MyFont-Regular');
		expect(meta.fullName).toBe('MyFont Regular');
		expect(meta.familyName).toBe('MyFont');
		expect(meta.subfamilyName).toBe('Regular');
		expect(meta.copyright).toBe('Copyright 2024 Test Foundry');
		expect(meta.version).toBe('Version 1.000');
		expect(meta.genDate).toBeTruthy();
	});
});

// ---------------------------------------------------------------------------
// getFontMetrics
// ---------------------------------------------------------------------------

describe('getFontMetrics', () => {
	it('returns OS/2 typo metrics when USE_TYPO_METRICS is set', () => {
		const font = mockLibFont({
			os2: { fsSelection: 0xC0, sTypoAscender: 900, sTypoDescender: -300, sTypoLineGap: 50 },
			hhea: { ascender: 1000, descender: -400, lineGap: 0 },
		});
		const metrics = getFontMetrics(font);
		expect(metrics.ascender).toBe(900);
		expect(metrics.descender).toBe(-300);
		expect(metrics.lineGap).toBe(50);
	});

	it('returns hhea metrics when USE_TYPO_METRICS is not set', () => {
		const font = mockLibFont({
			os2: { fsSelection: 0x40, sTypoAscender: 900, sTypoDescender: -300, sTypoLineGap: 50 },
			hhea: { ascender: 1000, descender: -400, lineGap: 0 },
		});
		const metrics = getFontMetrics(font);
		expect(metrics.ascender).toBe(1000);
		expect(metrics.descender).toBe(-400);
		expect(metrics.lineGap).toBe(0);
	});

	it('returns bounding box from head table', () => {
		const font = mockLibFont({ head: { xMin: 10, yMin: -50, xMax: 900, yMax: 750 } });
		const metrics = getFontMetrics(font);
		expect(metrics.boundingBox).toEqual({ xMin: 10, yMin: -50, xMax: 900, yMax: 750 });
	});

	it('returns capHeight and xHeight only for OS/2 version >= 2', () => {
		const font = mockLibFont({ os2: { version: 1, sCapHeight: 700, sxHeight: 500 } });
		const metrics = getFontMetrics(font);
		expect(metrics.capHeight).toBe(0);
		expect(metrics.xHeight).toBe(0);
	});

	it('returns capHeight and xHeight for OS/2 version >= 2', () => {
		const font = mockLibFont({ os2: { version: 4, sCapHeight: 700, sxHeight: 500 } });
		const metrics = getFontMetrics(font);
		expect(metrics.capHeight).toBe(700);
		expect(metrics.xHeight).toBe(500);
	});
});

// ---------------------------------------------------------------------------
// getVariationAxes
// ---------------------------------------------------------------------------

describe('getVariationAxes', () => {
	it('returns null for non-variable fonts', () => {
		const font = mockLibFont();
		expect(getVariationAxes(font)).toBeNull();
	});

	it('returns axis map for variable fonts', () => {
		const font = mockVariableFont();
		const axes = getVariationAxes(font);
		expect(axes).not.toBeNull();
		expect(axes.wght).toBeDefined();
		expect(axes.wght.min).toBe(100);
		expect(axes.wght.max).toBe(900);
		expect(axes.wght.default).toBe(400);
	});

	it('filters out degenerate axes (min === max)', () => {
		const font = mockLibFont({
			fvar: {
				axes: [
					{ tag: 'wght', minValue: 400, maxValue: 400, defaultValue: 400, flags: 0, axisNameID: 256 },
				],
				instances: [],
			},
		});
		expect(getVariationAxes(font)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// getNamedInstances
// ---------------------------------------------------------------------------

describe('getNamedInstances', () => {
	it('returns empty array for non-variable fonts', () => {
		const font = mockLibFont();
		expect(getNamedInstances(font)).toEqual([]);
	});

	it('maps fvar instances with name resolution', () => {
		const font = mockVariableFont({
			name: { 258: 'Regular', 259: 'Bold' },
		});
		const instances = getNamedInstances(font);
		expect(instances).toHaveLength(2);
		expect(instances[0].name).toBe('Regular');
		expect(instances[1].name).toBe('Bold');
		expect(instances[0].coordinates).toEqual([400, 0]);
	});
});

// ---------------------------------------------------------------------------
// Simple accessors
// ---------------------------------------------------------------------------

describe('simple accessors', () => {
	it('getWeightClass returns OS/2 usWeightClass', () => {
		expect(getWeightClass(mockLibFont({ os2: { usWeightClass: 700 } }))).toBe(700);
	});

	it('getWeightClass returns null when OS/2 is missing', () => {
		const font = mockLibFont();
		font.opentype.tables['OS/2'] = null;
		expect(getWeightClass(font)).toBeNull();
	});

	it('getFsSelection returns raw bitmask', () => {
		expect(getFsSelection(mockLibFont({ os2: { fsSelection: 0x21 } }))).toBe(0x21);
	});

	it('getMacStyle returns raw bitmask', () => {
		expect(getMacStyle(mockLibFont({ head: { macStyle: 0x03 } }))).toBe(0x03);
	});

	it('getItalicAngle returns post table value', () => {
		expect(getItalicAngle(mockBoldItalicFont())).toBe(-12);
	});

	it('getGlyphCount returns maxp numGlyphs', () => {
		expect(getGlyphCount(mockLibFont({ maxp: { numGlyphs: 1234 } }))).toBe(1234);
	});

	it('getFamilyClass returns sFamilyClass', () => {
		expect(getFamilyClass(mockLibFont({ os2: { sFamilyClass: 0x0801 } }))).toBe(0x0801);
	});
});

// ---------------------------------------------------------------------------
// escapeCssFontName
// ---------------------------------------------------------------------------

describe('escapeCssFontName', () => {
	it('escapes single quotes', () => {
		expect(escapeCssFontName("My'Font")).toBe("My\\'Font");
	});

	it('escapes double quotes', () => {
		expect(escapeCssFontName('My"Font')).toBe('My\\"Font');
	});

	it('removes semicolons', () => {
		expect(escapeCssFontName('MyFont; injection')).toBe('MyFont injection');
	});

	it('escapes backslashes', () => {
		expect(escapeCssFontName('My\\Font')).toBe('My\\\\Font');
	});

	it('handles clean names without changes', () => {
		expect(escapeCssFontName('Halyard Display Bold')).toBe('Halyard Display Bold');
	});
});

// ---------------------------------------------------------------------------
// getAllFeatureTags
// ---------------------------------------------------------------------------

describe('getAllFeatureTags', () => {
	it('returns an empty array when the font has no layout tables', () => {
		expect(getAllFeatureTags(mockLibFont())).toEqual([]);
	});

	it('unions tags across GSUB and GPOS, deduplicated', () => {
		const font = mockLibFont({
			GSUB: mockLayoutTable([{ tag: 'liga' }, { tag: 'ss01' }]),
			GPOS: mockLayoutTable([{ tag: 'kern' }, { tag: 'liga' }]),
		});
		expect(getAllFeatureTags(font).sort()).toEqual(['kern', 'liga', 'ss01']);
	});

	it('deduplicates the same feature repeated across scripts and languages', () => {
		const font = mockLibFont({
			GSUB: mockLayoutTable([{ tag: 'liga' }], { scripts: ['latn', 'cyrl'], langs: ['dflt', 'TRK '] }),
		});
		expect(getAllFeatureTags(font)).toEqual(['liga']);
	});

	it('survives a layout table that throws mid-traversal', () => {
		const font = mockLibFont({
			GSUB: { getSupportedScripts: () => { throw new Error('corrupt GSUB'); } },
			GPOS: mockLayoutTable([{ tag: 'kern' }]),
		});
		expect(getAllFeatureTags(font)).toEqual(['kern']);
	});
});

// ---------------------------------------------------------------------------
// getFeatureUiNames
// ---------------------------------------------------------------------------

describe('getFeatureUiNames', () => {
	/** Font whose ss01/cv01 labels live at name IDs 256 and 257 */
	const labelledFont = (features) => mockLibFont({
		name: { 256: 'Alternate g', 257: 'Flat-topped 3' },
		GSUB: mockLayoutTable(features),
	});

	it('returns an empty array when the font has no layout tables', () => {
		expect(getFeatureUiNames(mockLibFont())).toEqual([]);
	});

	it('reads the stylistic set label from FeatureParams.UINameID', () => {
		const font = labelledFont([{ tag: 'ss01', params: { version: 0, UINameID: 256 } }]);
		expect(getFeatureUiNames(font)).toEqual([{ tag: 'ss01', title: 'Alternate g' }]);
	});

	it('reads the character variant label from FeatureParams.featUiLabelNameId', () => {
		const font = labelledFont([{ tag: 'cv01', params: { format: 0, featUiLabelNameId: 257 } }]);
		expect(getFeatureUiNames(font)).toEqual([{ tag: 'cv01', title: 'Flat-topped 3' }]);
	});

	it('sorts by tag so the stored list is stable across runs', () => {
		const font = labelledFont([
			{ tag: 'cv01', params: { featUiLabelNameId: 257 } },
			{ tag: 'ss01', params: { UINameID: 256 } },
		]);
		expect(getFeatureUiNames(font).map((f) => f.tag)).toEqual(['cv01', 'ss01']);
	});

	it('ignores features that cannot carry a label', () => {
		// 'liga' has no FeatureParams in the spec; a mock that offers one must still be skipped.
		const font = labelledFont([{ tag: 'liga', params: { UINameID: 256 } }]);
		expect(getFeatureUiNames(font)).toEqual([]);
	});

	it('ignores a set with no FeatureParams', () => {
		const font = labelledFont([{ tag: 'ss02', params: undefined }]);
		expect(getFeatureUiNames(font)).toEqual([]);
	});

	it('rejects reserved name IDs below 256', () => {
		// nameID 0 is the copyright string — honouring it would title ss01 'Copyright 2024 Test Foundry'.
		const font = labelledFont([{ tag: 'ss01', params: { UINameID: 0 } }]);
		expect(getFeatureUiNames(font)).toEqual([]);
	});

	it('omits a set whose name record is missing rather than titling it blank', () => {
		const font = labelledFont([{ tag: 'ss03', params: { UINameID: 999 } }]);
		expect(getFeatureUiNames(font)).toEqual([]);
	});

	it('keeps the other labels when one set throws on FeatureParams', () => {
		const font = labelledFont([
			{ tag: 'ss01', throws: true },
			{ tag: 'cv01', params: { featUiLabelNameId: 257 } },
		]);
		expect(getFeatureUiNames(font)).toEqual([{ tag: 'cv01', title: 'Flat-topped 3' }]);
	});
});
