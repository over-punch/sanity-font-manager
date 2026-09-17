// Tests the pure showcase helpers and the showcase field factory's shape
import { describe, it, expect, vi } from 'vitest';

// The factory wires a Studio input and an icon; stub both so the schema imports without React/Studio.
vi.mock('../components/OpenTypeFeaturePicker.jsx', () => ({ OpenTypeFeaturePicker: 'OpenTypeFeaturePicker' }));
vi.mock('@liiift-studio/sanity-ui-compat/icons', () => ({ StringIcon: 'StringIcon' }));

import {
	featureTagsToCss,
	cssToFeatureTags,
	listDetectedFeatures,
	matchFeatureKey,
	resolveShowcaseCard,
} from '../utils/openTypeShowcase.js';
import { createOpenTypeShowcaseField } from '../schema/openTypeShowcaseField.js';

/** An openType value shaped like a reviewed document: two renamed sets, two numeral combinations. */
const OPEN_TYPE = {
	features: ['stylisticSet1', 'caseSensitiveForms', 'tabularLining', 'tabularOldstyle'],
	stylisticSet1: { title: 'Schoolbook a (ss01)', feature: 'ss01' },
	caseSensitiveForms: { title: 'Case Sensitive Forms', feature: 'case' },
	tabularLining: { title: 'Tabular Lining', feature: 'tnum lnum' },
	// No sub-object for tabularOldstyle: the canonical map has to fill it in.
};

describe('featureTagsToCss', () => {
	it('switches on every space-separated tag', () => {
		expect(featureTagsToCss('ss01')).toBe("'ss01' 1");
		expect(featureTagsToCss('tnum lnum')).toBe("'tnum' 1, 'lnum' 1");
	});

	it('returns an empty string for nothing', () => {
		expect(featureTagsToCss('')).toBe('');
		expect(featureTagsToCss(undefined)).toBe('');
	});
});

describe('cssToFeatureTags', () => {
	it('reads single- and double-quoted tags in order', () => {
		expect(cssToFeatureTags("'c2sc' 1, 'smcp' 1")).toEqual(['c2sc', 'smcp']);
		expect(cssToFeatureTags('"SS01" on')).toEqual(['ss01']);
	});

	it('treats a bare tag as on and skips tags switched off', () => {
		expect(cssToFeatureTags("'liga'")).toEqual(['liga']);
		expect(cssToFeatureTags("'liga' 0, 'dlig' 1, 'clig' off")).toEqual(['dlig']);
	});
});

describe('listDetectedFeatures', () => {
	it('lists checked features in stored order with their reviewed titles', () => {
		expect(listDetectedFeatures(OPEN_TYPE).map((f) => f.key)).toEqual(OPEN_TYPE.features);
		expect(listDetectedFeatures(OPEN_TYPE)[0]).toEqual({ key: 'stylisticSet1', title: 'Schoolbook a (ss01)', feature: 'ss01' });
	});

	it('falls back to the canonical title and tag when the sub-object is missing', () => {
		expect(listDetectedFeatures(OPEN_TYPE)[3]).toEqual({ key: 'tabularOldstyle', title: 'Tabular Oldstyle', feature: 'tnum onum' });
	});

	it('returns nothing for an empty or missing value', () => {
		expect(listDetectedFeatures(undefined)).toEqual([]);
		expect(listDetectedFeatures({})).toEqual([]);
	});
});

describe('matchFeatureKey', () => {
	it('matches a legacy CSS string to the detected feature with the same tags', () => {
		expect(matchFeatureKey("'ss01' 1", OPEN_TYPE)).toBe('stylisticSet1');
		expect(matchFeatureKey("'lnum' 1, 'tnum' 1", OPEN_TYPE)).toBe('tabularLining');
	});

	it('refuses a partial match rather than guess between combinations', () => {
		// 'tnum' alone sits inside both Tabular Lining and Tabular Oldstyle.
		expect(matchFeatureKey("'tnum' 1", OPEN_TYPE)).toBeNull();
	});

	it('returns null for undetected or empty input', () => {
		expect(matchFeatureKey("'dlig' 1", OPEN_TYPE)).toBeNull();
		expect(matchFeatureKey('', OPEN_TYPE)).toBeNull();
	});
});

describe('resolveShowcaseCard', () => {
	it('inherits the label and CSS from the picked feature', () => {
		expect(resolveShowcaseCard({ feature: 'stylisticSet1' }, OPEN_TYPE)).toEqual({
			key: 'stylisticSet1',
			detected: true,
			label: 'Schoolbook a (ss01)',
			css: "'ss01' 1",
		});
	});

	it('lets the card override the label and the CSS', () => {
		const card = { feature: 'tabularLining', label: 'Tabular Numbers', specialtyCss: "'tnum' 1" };
		expect(resolveShowcaseCard(card, OPEN_TYPE)).toMatchObject({ label: 'Tabular Numbers', css: "'tnum' 1" });
	});

	it('keeps rendering a card whose feature is no longer detected, and says so', () => {
		expect(resolveShowcaseCard({ feature: 'slashedZero' }, OPEN_TYPE)).toEqual({
			key: 'slashedZero',
			detected: false,
			label: 'Slashed Zero',
			css: "'zero' 1",
		});
	});

	it('falls back to the legacy stylisticFeature string for an unmigrated card', () => {
		const card = { label: 'Ligatures', stylisticFeature: "'dlig' 1" };
		expect(resolveShowcaseCard(card, OPEN_TYPE)).toEqual({ key: null, detected: false, label: 'Ligatures', css: "'dlig' 1" });
	});

	it('prefers the picked feature over a leftover legacy string', () => {
		const card = { feature: 'caseSensitiveForms', stylisticFeature: "'ss09' 1" };
		expect(resolveShowcaseCard(card, OPEN_TYPE).css).toBe("'case' 1");
	});
});

describe('createOpenTypeShowcaseField', () => {
	/** Field names of the single array member */
	const memberFieldNames = (field) => field.of[0].fields.map((f) => f.name);

	it('builds an array of picker-driven cards by default', () => {
		const field = createOpenTypeShowcaseField();
		expect(field).toMatchObject({ name: 'openTypeShowcase', type: 'array' });
		expect(field.of[0].name).toBe('featuredWord');
		expect(memberFieldNames(field)).toEqual(['feature', 'content', 'glyphs', 'label', 'size', 'italics', 'ligatures', 'calt', 'specialtyCss']);
		expect(field.of[0].fields[0].components.input).toBe('OpenTypeFeaturePicker');
		expect(field.of[0].fields[0].options.openTypePath).toEqual(['openType']);
		expect(field).not.toHaveProperty('group');
	});

	it('adopts an existing array in place', () => {
		const field = createOpenTypeShowcaseField({ name: 'featured', group: 'openType', legacyFeatureField: true, sizes: false });
		expect(field).toMatchObject({ name: 'featured', group: 'openType' });
		expect(memberFieldNames(field)).not.toContain('size');
		const legacy = field.of[0].fields.find((f) => f.name === 'stylisticFeature');
		expect(legacy).toMatchObject({ type: 'string', hidden: true, readOnly: true });
	});

	it('subtitles a card by its label, then by the picked feature', () => {
		const { prepare } = createOpenTypeShowcaseField().of[0].preview;
		expect(prepare({ content: 'L`if`t', label: 'Ligatures', feature: 'standardLigatures' })).toEqual({ title: 'L`if`t', subtitle: 'Ligatures' });
		expect(prepare({ content: 'a', feature: 'stylisticSet1' }).subtitle).toBe('Stylistic Set 1');
		expect(prepare({})).toEqual({ title: 'Empty demo', subtitle: 'No feature picked' });
	});
});
