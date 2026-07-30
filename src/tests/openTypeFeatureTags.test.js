// Drift guard — asserts OPENTYPE_FEATURE_TAGS stays in sync with the feature keys and tags defined in openTypeField
import { describe, it, expect, vi } from 'vitest';

// openTypeField wires SetOTF as its input component; stub it so the schema can be imported without React/Studio.
vi.mock('../components/SetOTF.jsx', () => ({ SetOTF: 'SetOTF' }));

import { openTypeField } from '../schema/openTypeField.js';
import { OPENTYPE_FEATURE_TAGS } from '../schema/openTypeFeatureTags.js';

/** Returns the initialValue of a named subfield within a feature object, if present */
const subfieldInitialValue = (field, name) => field.fields?.find((f) => f.name === name)?.initialValue;

/** Every openTypeField entry that represents a feature (an object carrying a `feature` tag) */
const schemaFeatureFields = openTypeField.fields.filter(
	(field) => field.type === 'object' && subfieldInitialValue(field, 'feature')
);

describe('OPENTYPE_FEATURE_TAGS', () => {
	it('covers every feature object defined in the schema', () => {
		const schemaKeys = schemaFeatureFields.map((f) => f.name).sort();
		expect(Object.keys(OPENTYPE_FEATURE_TAGS).sort()).toEqual(schemaKeys);
	});

	it('matches the schema feature tag for every key', () => {
		for (const field of schemaFeatureFields) {
			expect(OPENTYPE_FEATURE_TAGS[field.name].feature).toBe(subfieldInitialValue(field, 'feature'));
		}
	});

	it('lists every key in the features checkbox options', () => {
		const featuresField = openTypeField.fields.find((f) => f.name === 'features');
		const optionValues = featuresField.options.list.map((option) => option.value).sort();
		expect(Object.keys(OPENTYPE_FEATURE_TAGS).sort()).toEqual(optionValues);
	});

	it('gives every key a non-empty title and lowercase 4-character tags', () => {
		for (const [key, meta] of Object.entries(OPENTYPE_FEATURE_TAGS)) {
			expect(meta.title, `${key} title`).toBeTruthy();
			for (const tag of meta.feature.split(' ')) {
				expect(tag, `${key} tag "${tag}"`).toMatch(/^[a-z0-9]{4}$/);
			}
		}
	});
});
