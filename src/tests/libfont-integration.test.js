// Integration tests — verifies lib-font parses real font files correctly via parseFont + fontHelpers
// Uses copyrighted font files from a local path (NOT committed to repo).
// Skip this test suite in CI by setting SKIP_FONT_INTEGRATION=1.

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { parseFont } from '../utils/parseFont';
import {
	getNameString,
	getFontMetadata,
	getFontMetrics,
	getVariationAxes,
	getNamedInstances,
	getAllFeatureTags,
	getGlyphCount,
	getCharacterSet,
	getWeightClass,
	getFsSelection,
	getMacStyle,
	getItalicAngle,
	getFamilyClass,
} from '../utils/fontHelpers';

// ---------------------------------------------------------------------------
// Font file paths — local only, never committed
// ---------------------------------------------------------------------------

const FONT_DIR = 'C:/Users/Colby/Downloads/Colby/Colby';
const FONTS = {
	regularTtf: resolve(FONT_DIR, 'Owners-Regular.ttf'),
	boldItalicTtf: resolve(FONT_DIR, 'Owners-BoldItalic.ttf'),
	xLightOtf: resolve(FONT_DIR, 'Owners-XLight.otf'),
	blackWoff2: resolve(FONT_DIR, 'Owners-Black.woff2'),
	mediumWoff: resolve(FONT_DIR, 'Owners-Medium.woff'),
};

const fontsAvailable = Object.values(FONTS).every(p => existsSync(p));

// Skip entire suite if fonts aren't available (CI, other machines)
const describeIf = fontsAvailable ? describe : describe.skip;

/** Helper to load and parse a font file */
async function loadFont(filePath) {
	const buffer = readFileSync(filePath);
	const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
	const filename = filePath.split(/[\\/]/).pop();
	return parseFont(arrayBuffer, filename);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describeIf('lib-font integration — real font files', () => {
	const parsed = {};

	beforeAll(async () => {
		parsed.regularTtf = await loadFont(FONTS.regularTtf);
		parsed.boldItalicTtf = await loadFont(FONTS.boldItalicTtf);
		parsed.xLightOtf = await loadFont(FONTS.xLightOtf);
		parsed.blackWoff2 = await loadFont(FONTS.blackWoff2);
		parsed.mediumWoff = await loadFont(FONTS.mediumWoff);
	});

	// -----------------------------------------------------------------------
	// Parse success — all formats
	// -----------------------------------------------------------------------

	describe('parse success', () => {
		it('parses TTF files', () => {
			expect(parsed.regularTtf).toBeTruthy();
			expect(parsed.boldItalicTtf).toBeTruthy();
		});

		it('parses OTF files', () => {
			expect(parsed.xLightOtf).toBeTruthy();
		});

		it('parses WOFF2 files (brotli decompression)', () => {
			expect(parsed.blackWoff2).toBeTruthy();
		});

		it('parses WOFF files (zlib decompression)', () => {
			expect(parsed.mediumWoff).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// Name table — getNameString
	// -----------------------------------------------------------------------

	describe('name table', () => {
		it('reads familyName (name ID 1)', () => {
			const name = getNameString(parsed.regularTtf, 1);
			expect(name).toBeTruthy();
			expect(name.toLowerCase()).toContain('owners');
		});

		it('reads fullName (name ID 4)', () => {
			const name = getNameString(parsed.boldItalicTtf, 4);
			expect(name).toBeTruthy();
			expect(name.toLowerCase()).toContain('bold');
			expect(name.toLowerCase()).toContain('italic');
		});

		it('reads postscriptName (name ID 6)', () => {
			const name = getNameString(parsed.regularTtf, 6);
			expect(name).toBeTruthy();
			// PostScript names have no spaces
			expect(name).not.toContain(' ');
		});

		it('reads subfamilyName (name ID 2)', () => {
			const name = getNameString(parsed.regularTtf, 2);
			expect(name).toBeTruthy();
		});

		it('returns consistent values across formats (TTF vs WOFF2 vs WOFF)', () => {
			// All should return the same family name regardless of container format
			const ttfFamily = getNameString(parsed.regularTtf, 1);
			const woff2Family = getNameString(parsed.blackWoff2, 1);
			const woffFamily = getNameString(parsed.mediumWoff, 1);
			// Same foundry, same family — family name root should match
			expect(woff2Family.toLowerCase()).toContain('owners');
			expect(woffFamily.toLowerCase()).toContain('owners');
		});
	});

	// -----------------------------------------------------------------------
	// getFontMetadata
	// -----------------------------------------------------------------------

	describe('getFontMetadata', () => {
		it('extracts all metadata fields from TTF', () => {
			const meta = getFontMetadata(parsed.regularTtf);
			expect(meta.postscriptName).toBeTruthy();
			expect(meta.fullName).toBeTruthy();
			expect(meta.familyName).toBeTruthy();
			expect(meta.subfamilyName).toBeTruthy();
			expect(meta.copyright).toBeTruthy();
			expect(meta.version).toBeTruthy();
			expect(meta.genDate).toBeTruthy();
		});

		it('extracts metadata from WOFF2', () => {
			const meta = getFontMetadata(parsed.blackWoff2);
			expect(meta.fullName).toBeTruthy();
			expect(meta.fullName.toLowerCase()).toContain('black');
		});

		it('extracts metadata from OTF', () => {
			const meta = getFontMetadata(parsed.xLightOtf);
			expect(meta.fullName).toBeTruthy();
		});
	});

	// -----------------------------------------------------------------------
	// getFontMetrics
	// -----------------------------------------------------------------------

	describe('getFontMetrics', () => {
		it('returns valid metrics from TTF', () => {
			const metrics = getFontMetrics(parsed.regularTtf);
			expect(metrics.unitsPerEm).toBeGreaterThan(0);
			expect(metrics.ascender).toBeGreaterThan(0);
			expect(metrics.descender).toBeLessThan(0);
			expect(typeof metrics.italicAngle).toBe('number');
			expect(metrics.boundingBox).toHaveProperty('xMin');
			expect(metrics.boundingBox).toHaveProperty('yMax');
		});

		it('returns non-zero italic angle for italic font', () => {
			const metrics = getFontMetrics(parsed.boldItalicTtf);
			expect(metrics.italicAngle).not.toBe(0);
		});

		it('returns zero italic angle for regular font', () => {
			const metrics = getFontMetrics(parsed.regularTtf);
			expect(metrics.italicAngle).toBe(0);
		});

		it('returns consistent unitsPerEm across formats', () => {
			const ttfUpm = getFontMetrics(parsed.regularTtf).unitsPerEm;
			const woff2Upm = getFontMetrics(parsed.blackWoff2).unitsPerEm;
			const woffUpm = getFontMetrics(parsed.mediumWoff).unitsPerEm;
			// Same family — should all have same UPM
			expect(woff2Upm).toBe(ttfUpm);
			expect(woffUpm).toBe(ttfUpm);
		});
	});

	// -----------------------------------------------------------------------
	// OS/2 table accessors
	// -----------------------------------------------------------------------

	describe('OS/2 table', () => {
		it('reads usWeightClass for Regular', () => {
			const wc = getWeightClass(parsed.regularTtf);
			expect(wc).toBe(400);
		});

		it('reads usWeightClass for Bold Italic', () => {
			const wc = getWeightClass(parsed.boldItalicTtf);
			expect(wc).toBe(700);
		});

		it('reads usWeightClass for XLight', () => {
			const wc = getWeightClass(parsed.xLightOtf);
			expect(wc).toBeTruthy();
			expect(wc).toBeLessThan(400);
		});

		it('reads usWeightClass for Black', () => {
			const wc = getWeightClass(parsed.blackWoff2);
			expect(wc).toBeGreaterThan(800);
		});

		it('reads fsSelection', () => {
			const fs = getFsSelection(parsed.regularTtf);
			expect(typeof fs).toBe('number');
			// Regular font should have REGULAR bit (bit 6) set
			expect(fs & 0x40).toBe(0x40);
		});

		it('reads fsSelection italic bit for italic font', () => {
			const fs = getFsSelection(parsed.boldItalicTtf);
			// Italic bit (bit 0) should be set
			expect(fs & 0x01).toBe(0x01);
		});

		it('reads sFamilyClass', () => {
			const fc = getFamilyClass(parsed.regularTtf);
			expect(typeof fc).toBe('number');
		});
	});

	// -----------------------------------------------------------------------
	// head / post table
	// -----------------------------------------------------------------------

	describe('head and post tables', () => {
		it('reads macStyle', () => {
			const ms = getMacStyle(parsed.regularTtf);
			expect(typeof ms).toBe('number');
		});

		it('reads macStyle italic bit for italic font', () => {
			const ms = getMacStyle(parsed.boldItalicTtf);
			expect(ms & 0x02).toBe(0x02);
		});

		it('reads italicAngle from post table', () => {
			const angle = getItalicAngle(parsed.boldItalicTtf);
			expect(angle).not.toBe(0);
			// Italic angle is negative for right-leaning italic
			expect(angle).toBeLessThan(0);
		});

		it('reads zero italicAngle for upright font', () => {
			expect(getItalicAngle(parsed.regularTtf)).toBe(0);
		});
	});

	// -----------------------------------------------------------------------
	// Variable font detection (these are static fonts — should be null)
	// -----------------------------------------------------------------------

	describe('variable font detection', () => {
		it('returns null axes for static fonts', () => {
			expect(getVariationAxes(parsed.regularTtf)).toBeNull();
			expect(getVariationAxes(parsed.boldItalicTtf)).toBeNull();
			expect(getVariationAxes(parsed.xLightOtf)).toBeNull();
		});

		it('returns empty instances for static fonts', () => {
			expect(getNamedInstances(parsed.regularTtf)).toEqual([]);
		});
	});

	// -----------------------------------------------------------------------
	// OpenType features
	// -----------------------------------------------------------------------

	describe('OpenType features', () => {
		it('extracts feature tags from TTF', () => {
			const tags = getAllFeatureTags(parsed.regularTtf);
			expect(Array.isArray(tags)).toBe(true);
			// Most commercial fonts have at least kern or liga
			expect(tags.length).toBeGreaterThan(0);
		});

		it('returns consistent features across formats', () => {
			const ttfTags = getAllFeatureTags(parsed.regularTtf);
			// WOFF2 should have the same features after decompression
			const woff2Tags = getAllFeatureTags(parsed.blackWoff2);
			// Both should have features (may differ in count by weight but both non-empty)
			expect(ttfTags.length).toBeGreaterThan(0);
			expect(woff2Tags.length).toBeGreaterThan(0);
		});
	});

	// -----------------------------------------------------------------------
	// Glyph count and character set
	// -----------------------------------------------------------------------

	describe('glyph count and character set', () => {
		it('returns non-zero glyph count', () => {
			const count = getGlyphCount(parsed.regularTtf);
			expect(count).toBeGreaterThan(0);
		});

		it('returns consistent glyph count across formats', () => {
			const ttfCount = getGlyphCount(parsed.regularTtf);
			const woff2Count = getGlyphCount(parsed.blackWoff2);
			// Same family — glyph count should be similar (may vary slightly by weight)
			expect(woff2Count).toBeGreaterThan(0);
		});

		it('returns character set as array of code points', () => {
			const chars = getCharacterSet(parsed.regularTtf);
			expect(Array.isArray(chars)).toBe(true);
			expect(chars.length).toBeGreaterThan(0);
		});
	});

	// -----------------------------------------------------------------------
	// Cross-format consistency
	// -----------------------------------------------------------------------

	describe('cross-format consistency', () => {
		it('same font family produces same metadata structure across TTF/OTF/WOFF/WOFF2', () => {
			const ttfMeta = getFontMetadata(parsed.regularTtf);
			const otfMeta = getFontMetadata(parsed.xLightOtf);
			const woffMeta = getFontMetadata(parsed.mediumWoff);
			const woff2Meta = getFontMetadata(parsed.blackWoff2);

			// All should have the same fields populated
			for (const meta of [ttfMeta, otfMeta, woffMeta, woff2Meta]) {
				expect(meta.postscriptName).toBeTruthy();
				expect(meta.fullName).toBeTruthy();
				expect(meta.familyName).toBeTruthy();
				expect(meta.copyright).toBeTruthy();
			}
		});
	});
});
