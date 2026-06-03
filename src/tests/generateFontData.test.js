// Tests for generateFontData utility — buildFontMetadata metadata and metrics extraction
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildFontMetadata } from '../utils/generateFontData';
import { mockLibFont } from './fixtures/mockLibFont';

/** Builds a lib-font-shaped mock font for generateFontData tests */
function mockFont(overrides = {}) {
	return mockLibFont({
		name: {
			0: overrides.copyright ?? 'Copyright 2024 MyFoundry',
			1: overrides.familyName ?? 'MyFont',
			2: overrides.subfamilyName ?? 'Regular',
			4: overrides.fullName ?? 'MyFont Regular',
			5: overrides.version ?? 'Version 1.005',
			6: overrides.postscriptName ?? 'MyFont-Regular',
		},
		os2: {
			usWeightClass: 400,
			fsSelection: overrides.useTypoMetrics ? 0xC0 : 0x40,
			sTypoAscender: overrides.ascender ?? 800,
			sTypoDescender: overrides.descender ?? -200,
			sTypoLineGap: overrides.lineGap ?? 0,
			sCapHeight: overrides.capHeight ?? 660,
			sxHeight: overrides.xHeight ?? 480,
			version: 4,
		},
		head: {
			unitsPerEm: overrides.unitsPerEm ?? 1000,
			xMin: overrides.bbox?.xMin ?? -10,
			yMin: overrides.bbox?.yMin ?? -200,
			xMax: overrides.bbox?.xMax ?? 1000,
			yMax: overrides.bbox?.yMax ?? 800,
		},
		post: {
			italicAngle: overrides.italicAngle ?? 0,
			underlinePosition: overrides.underlinePosition ?? -75,
			underlineThickness: overrides.underlineThickness ?? 50,
		},
		hhea: {
			ascender: overrides.ascender ?? 800,
			descender: overrides.descender ?? -200,
			lineGap: overrides.lineGap ?? 0,
		},
	});
}

describe('buildFontMetadata', () => {
	let dateSpy;

	beforeEach(() => {
		dateSpy = vi.spyOn(Date.prototype, 'toISOString').mockReturnValue('2024-01-01T00:00:00.000Z');
	});

	afterEach(() => {
		dateSpy.mockRestore();
	});

	it('extracts postscriptName, fullName, familyName, subfamilyName, copyright', () => {
		const { metaData } = buildFontMetadata(mockFont());
		expect(metaData.postscriptName).toBe('MyFont-Regular');
		expect(metaData.fullName).toBe('MyFont Regular');
		expect(metaData.familyName).toBe('MyFont');
		expect(metaData.subfamilyName).toBe('Regular');
		expect(metaData.copyright).toBe('Copyright 2024 MyFoundry');
	});

	it('strips "Version " prefix from version string', () => {
		const { metaData } = buildFontMetadata(mockFont({ version: 'Version 2.001' }));
		expect(metaData.version).toBe('2.001');
	});

	it('handles version strings that already lack the "Version " prefix', () => {
		const { metaData } = buildFontMetadata(mockFont({ version: '1.005' }));
		expect(metaData.version).toBe('1.005');
	});

	it('handles null/undefined version gracefully', () => {
		const font = mockFont();
		// Override name ID 5 to return empty string (simulating missing version)
		font.opentype.tables.name.nameRecords = font.opentype.tables.name.nameRecords.filter(r => r.nameID !== 5);
		const { metaData } = buildFontMetadata(font);
		expect(metaData.version).toBe('');
	});

	it('sets genDate to the current ISO timestamp', () => {
		const { metaData } = buildFontMetadata(mockFont());
		expect(metaData.genDate).toBe('2024-01-01T00:00:00.000Z');
	});

	it('extracts all metric fields', () => {
		const { metrics } = buildFontMetadata(mockFont({ useTypoMetrics: true }));
		expect(metrics.unitsPerEm).toBe(1000);
		expect(metrics.ascender).toBe(800);
		expect(metrics.descender).toBe(-200);
		expect(metrics.lineGap).toBe(0);
		expect(metrics.underlinePosition).toBe(-75);
		expect(metrics.underlineThickness).toBe(50);
		expect(metrics.italicAngle).toBe(0);
		expect(metrics.capHeight).toBe(660);
		expect(metrics.xHeight).toBe(480);
	});

	it('returns boundingBox from head table fields', () => {
		const { metrics } = buildFontMetadata(mockFont({
			bbox: { xMin: -50, yMin: -250, xMax: 1100, yMax: 850 },
		}));
		expect(metrics.boundingBox).toEqual({ xMin: -50, yMin: -250, xMax: 1100, yMax: 850 });
	});

	it('uses hhea metrics when USE_TYPO_METRICS is not set', () => {
		const font = mockLibFont({
			os2: { fsSelection: 0x40, sTypoAscender: 900, sTypoDescender: -300, version: 4 },
			hhea: { ascender: 1000, descender: -400, lineGap: 10 },
		});
		const { metrics } = buildFontMetadata(font);
		expect(metrics.ascender).toBe(1000);
		expect(metrics.descender).toBe(-400);
		expect(metrics.lineGap).toBe(10);
	});

	it('uses OS/2 typo metrics when USE_TYPO_METRICS is set', () => {
		const font = mockLibFont({
			os2: { fsSelection: 0xC0, sTypoAscender: 900, sTypoDescender: -300, sTypoLineGap: 50, version: 4 },
			hhea: { ascender: 1000, descender: -400, lineGap: 0 },
		});
		const { metrics } = buildFontMetadata(font);
		expect(metrics.ascender).toBe(900);
		expect(metrics.descender).toBe(-300);
		expect(metrics.lineGap).toBe(50);
	});
});
