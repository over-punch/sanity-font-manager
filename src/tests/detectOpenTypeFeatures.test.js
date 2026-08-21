// Tests for detectOpenTypeFeatures — tag union across styles, multi-tag features, and value preservation
import { describe, it, expect } from 'vitest';

import { collectSupportedTags, dedupeFontDocs, detectOpenTypeFeatures } from '../utils/detectOpenTypeFeatures.js';

/** Builds a minimal font document carrying the given feature tags */
const font = (id, chars) => ({ _id: id, opentypeFeatures: { chars } });

describe('dedupeFontDocs', () => {
	it('prefers the draft when both copies of a font come back', () => {
		const docs = dedupeFontDocs([
			{ _id: 'daith-big-thin', opentypeFeatures: { chars: ['liga'] } },
			{ _id: 'drafts.daith-big-thin', opentypeFeatures: { chars: ['liga', 'ss01'] } },
		]);
		expect(docs).toHaveLength(1);
		expect(docs[0]._id).toBe('drafts.daith-big-thin');
	});

	it('keeps distinct fonts and id-less documents, and drops nullish entries', () => {
		expect(dedupeFontDocs([{ _id: 'a' }, { _id: 'b' }, {}, null, undefined])).toHaveLength(3);
	});

	it('does not inflate the style count when drafts and published both match', () => {
		// The count feeds the "across N of M styles" message — it must not exceed the real style count.
		const both = [
			font('a', ['liga']),
			{ _id: 'drafts.a', opentypeFeatures: { chars: ['liga'] } },
		];
		expect(collectSupportedTags(both).fontsWithData).toBe(1);
	});
});

describe('collectSupportedTags', () => {
	it('unions tags across every style', () => {
		const { tags, fontsWithData } = collectSupportedTags([
			font('roman', ['liga', 'ss01']),
			font('italic', ['liga', 'dlig']),
		]);
		expect([...tags].sort()).toEqual(['dlig', 'liga', 'ss01']);
		expect(fontsWithData).toBe(2);
	});

	it('ignores styles with missing, empty, or non-array feature data', () => {
		const { tags, fontsWithData } = collectSupportedTags([
			font('a', ['liga']),
			{ _id: 'b' },
			{ _id: 'c', opentypeFeatures: {} },
			{ _id: 'd', opentypeFeatures: { chars: [] } },
			{ _id: 'e', opentypeFeatures: { chars: 'liga' } },
			null,
		]);
		expect([...tags]).toEqual(['liga']);
		expect(fontsWithData).toBe(1);
	});

	it('trims whitespace and drops non-string entries', () => {
		const { tags } = collectSupportedTags([font('a', [' liga ', '', '   ', 42, null, 'ss01'])]);
		expect([...tags].sort()).toEqual(['liga', 'ss01']);
	});
});

describe('detectOpenTypeFeatures', () => {
	it('detects features from the schema map, not from the existing value', () => {
		// The regression this fixes: an empty value must still produce detections.
		const { features } = detectOpenTypeFeatures([font('a', ['liga', 'dlig'])], {});
		expect(features).toContain('standardLigatures');
		expect(features).toContain('discretionaryLigatures');
	});

	it('requires every tag of a multi-tag feature', () => {
		const partial = detectOpenTypeFeatures([font('a', ['pnum'])], {});
		expect(partial.features).not.toContain('proportionalOldstyle');

		const complete = detectOpenTypeFeatures([font('a', ['pnum', 'onum'])], {});
		expect(complete.features).toContain('proportionalOldstyle');
	});

	it('only reports allStylisticSets when the full ss01-ss20 run is present', () => {
		const partial = detectOpenTypeFeatures([font('a', ['ss01', 'ss02'])], {});
		expect(partial.features).toContain('stylisticSet1');
		expect(partial.features).toContain('stylisticSet2');
		expect(partial.features).not.toContain('allStylisticSets');

		const all = Array.from({ length: 20 }, (_, i) => `ss${String(i + 1).padStart(2, '0')}`);
		expect(detectOpenTypeFeatures([font('a', all)], {}).features).toContain('allStylisticSets');
	});

	it('writes the canonical title and feature tag for each detected feature', () => {
		const { detected } = detectOpenTypeFeatures([font('a', ['smcp'])], {});
		expect(detected.smallCaps).toEqual({ title: 'Small Caps', feature: 'smcp' });
	});

	it('preserves existing sub-object edits but resets the feature tag', () => {
		const value = { smallCaps: { title: 'Petite-ish Caps', customText: 'HELLO', feature: 'wrong' } };
		const { detected } = detectOpenTypeFeatures([font('a', ['smcp'])], value);
		expect(detected.smallCaps.title).toBe('Petite-ish Caps');
		expect(detected.smallCaps.customText).toBe('HELLO');
		expect(detected.smallCaps.feature).toBe('smcp');
	});

	it('reports zero features and no data when no style carries tags', () => {
		const result = detectOpenTypeFeatures([{ _id: 'a' }], {});
		expect(result.features).toEqual([]);
		expect(result.fontsWithData).toBe(0);
	});

	it('detects a union feature that no single style supports alone', () => {
		// Romans carry lnum, italics carry pnum — tabularLining needs tnum+lnum, so it must NOT match,
		// while proportionalLining (pnum+lnum) must, since the union spans both styles.
		const result = detectOpenTypeFeatures([font('roman', ['lnum']), font('italic', ['pnum'])], {});
		expect(result.features).toContain('proportionalLining');
		expect(result.features).not.toContain('tabularLining');
	});

	it('handles no styles at all without throwing', () => {
		const result = detectOpenTypeFeatures([], {});
		expect(result).toMatchObject({ features: [], fontsWithData: 0, supportedTags: [] });
	});

	it('reproduces the real Daith tag set', () => {
		// Tags read from the published Daith romans — the case that reported zero features before the fix.
		const daith = ['aalt', 'calt', 'case', 'ccmp', 'dlig', 'dnom', 'fina', 'frac', 'init', 'liga', 'lnum',
			'numr', 'onum', 'ordn', 'pnum', 'sinf', 'ss01', 'ss02', 'ss03', 'ss04', 'ss05', 'ss06', 'ss20',
			'subs', 'sups', 'tnum', 'zero', 'locl', 'kern', 'mark', 'mkmk'];
		const { features } = detectOpenTypeFeatures([font('daith-big-thin', daith)], {});

		expect(features.length).toBeGreaterThan(20);
		expect(features).toEqual(expect.arrayContaining([
			'allAlternates', 'caseSensitiveForms', 'contextualAlternates', 'discretionaryLigatures',
			'fractions', 'localizedForms', 'standardLigatures', 'slashedZero', 'terminalForm',
			'proportionalOldstyle', 'tabularLining', 'stylisticSet1', 'stylisticSet20',
		]));
		// Daith has no small caps, petite caps, swashes or cpsp — these must stay off.
		expect(features).not.toEqual(expect.arrayContaining(['smallCaps', 'petiteCaps', 'swash', 'allCaps']));
	});
});

describe('font-supplied feature titles', () => {
	/** Builds a font document carrying both feature tags and the foundry's labels for them */
	const named = (id, chars, featureList) => ({ _id: id, opentypeFeatures: { chars, featureList } });

	it('titles a stylistic set with the name the font supplies', () => {
		const docs = [named('roman', ['ss01'], [{ tag: 'ss01', title: 'Alternate g' }])];
		const { detected, namedFeatures } = detectOpenTypeFeatures(docs, {});
		expect(detected.stylisticSet1.title).toBe('Alternate g');
		expect(namedFeatures).toBe(1);
	});

	it('falls back to the canonical title when the font names nothing', () => {
		const { detected, namedFeatures } = detectOpenTypeFeatures([named('roman', ['ss01'], [])], {});
		expect(detected.stylisticSet1.title).toBe('Stylistic Set 1');
		expect(namedFeatures).toBe(0);
	});

	it('replaces a previously auto-filled canonical title', () => {
		// The old behaviour wrote 'Stylistic Set 1' into the document, and the value spread made it
		// permanent — a font label could never land on a typeface that had been detected before.
		const docs = [named('roman', ['ss01'], [{ tag: 'ss01', title: 'Alternate g' }])];
		const value = { stylisticSet1: { title: 'Stylistic Set 1', feature: 'ss01' } };
		expect(detectOpenTypeFeatures(docs, value).detected.stylisticSet1.title).toBe('Alternate g');
	});

	it('never overwrites a title an editor typed', () => {
		const docs = [named('roman', ['ss01'], [{ tag: 'ss01', title: 'Alternate g' }])];
		const value = { stylisticSet1: { title: 'Single-storey g', feature: 'ss01' } };
		const { detected, namedFeatures } = detectOpenTypeFeatures(docs, value);
		expect(detected.stylisticSet1.title).toBe('Single-storey g');
		expect(namedFeatures).toBe(0);
	});

	it('preserves sibling fields while retitling', () => {
		const docs = [named('roman', ['ss01'], [{ tag: 'ss01', title: 'Alternate g' }])];
		const value = { stylisticSet1: { title: 'Stylistic Set 1', customText: 'agile', feature: 'xxxx' } };
		const { detected } = detectOpenTypeFeatures(docs, value);
		expect(detected.stylisticSet1).toEqual({
			title: 'Alternate g',
			customText: 'agile',
			feature: 'ss01',
		});
	});

	it('takes the first style that names a tag when styles disagree', () => {
		const docs = [
			named('roman', ['ss01'], [{ tag: 'ss01', title: 'Alternate g' }]),
			named('italic', ['ss01'], [{ tag: 'ss01', title: 'Swash g' }]),
		];
		expect(detectOpenTypeFeatures(docs, {}).detected.stylisticSet1.title).toBe('Alternate g');
	});

	it('leaves multi-tag features on their canonical title', () => {
		// 'pnum onum' is our grouping of two tags — the font never labels the combination.
		const docs = [named('roman', ['pnum', 'onum'], [{ tag: 'pnum', title: 'Not a real label' }])];
		expect(detectOpenTypeFeatures(docs, {}).detected.proportionalOldstyle.title).toBe('Proportional Oldstyle');
	});

	it('ignores malformed featureList entries', () => {
		const docs = [named('roman', ['ss01'], [null, { tag: 'ss01' }, { title: 'orphan' }, { tag: '  ', title: 'x' }])];
		expect(detectOpenTypeFeatures(docs, {}).detected.stylisticSet1.title).toBe('Stylistic Set 1');
	});

	it('handles documents written before featureList existed', () => {
		const legacy = [{ _id: 'roman', opentypeFeatures: { chars: ['ss01'] } }];
		expect(detectOpenTypeFeatures(legacy, {}).detected.stylisticSet1.title).toBe('Stylistic Set 1');
	});

	it('prefers the draft style\'s labels over the published copy', () => {
		const docs = [
			named('roman', ['ss01'], [{ tag: 'ss01', title: 'Old name' }]),
			named('drafts.roman', ['ss01'], [{ tag: 'ss01', title: 'New name' }]),
		];
		expect(detectOpenTypeFeatures(docs, {}).detected.stylisticSet1.title).toBe('New name');
	});
});
