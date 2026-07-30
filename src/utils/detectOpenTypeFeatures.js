// Pure helpers that decide which openType features a typeface supports, from its styles' stored feature tags

import { OPENTYPE_FEATURE_TAGS } from '../schema/openTypeFeatureTags.js';

/**
 * Reduces draft/published pairs of the same font to a single document, preferring the draft — that is
 * what the editor is looking at. Without this, a lookup covering both ids counts the same style twice.
 * @param {object[]} fontDocs - font documents carrying `_id`
 * @returns {object[]} one document per underlying font
 */
export function dedupeFontDocs(fontDocs = []) {
	const byBaseId = new Map();

	for (const doc of fontDocs) {
		if (!doc) continue;
		// An id-less document can't be paired with anything, so keep it under its own key rather than drop it.
		if (!doc._id) {
			byBaseId.set(Symbol('no-id'), doc);
			continue;
		}
		const isDraft = doc._id.startsWith('drafts.');
		const baseId = isDraft ? doc._id.slice('drafts.'.length) : doc._id;
		if (isDraft || !byBaseId.has(baseId)) byBaseId.set(baseId, doc);
	}

	return [...byBaseId.values()];
}

/**
 * Collects the union of OpenType layout tags across every supplied font document.
 * A family's styles rarely agree — italics routinely drop stylistic sets the romans carry — so the
 * union answers "what can this typeface do", which is what a family-level field describes.
 * @param {object[]} fontDocs - font documents projected with `_id` and `opentypeFeatures`
 * @returns {{tags: Set<string>, fontsWithData: number}} union of tags, and how many styles carried any
 */
export function collectSupportedTags(fontDocs = []) {
	const tags = new Set();
	let fontsWithData = 0;

	for (const doc of dedupeFontDocs(fontDocs)) {
		const chars = doc?.opentypeFeatures?.chars;
		if (!Array.isArray(chars) || chars.length === 0) continue;
		fontsWithData++;
		for (const tag of chars) {
			if (typeof tag !== 'string') continue;
			const trimmed = tag.trim();
			if (trimmed) tags.add(trimmed);
		}
	}

	return { tags, fontsWithData };
}

/**
 * Matches the configured feature keys against the tags the family's styles actually expose.
 *
 * Unlike the previous implementation this reads the key list from `OPENTYPE_FEATURE_TAGS` rather
 * than from the document's own value. The per-feature sub-objects are hidden until their key is
 * checked in `features`, so Sanity never materialises them and their `feature` initialValues never
 * reach the document — reading the value could therefore only ever detect zero features.
 *
 * Existing sub-object edits are preserved (a hand-written `title` or `customText` survives), but the
 * `feature` tag is always reset to the canonical value.
 *
 * @param {object[]} fontDocs - font documents projected with `opentypeFeatures`
 * @param {object} value - current value of the openType object field
 * @returns {{features: string[], detected: object, fontsWithData: number, supportedTags: string[]}}
 */
export function detectOpenTypeFeatures(fontDocs = [], value = {}) {
	const { tags, fontsWithData } = collectSupportedTags(fontDocs);
	const features = [];
	const detected = {};

	for (const [key, meta] of Object.entries(OPENTYPE_FEATURE_TAGS)) {
		const required = meta.feature.split(' ').filter(Boolean);
		if (required.length === 0) continue;
		if (!required.every((tag) => tags.has(tag))) continue;

		features.push(key);
		detected[key] = {
			title: meta.title,
			...(value?.[key] || {}),
			feature: meta.feature,
		};
	}

	return { features, detected, fontsWithData, supportedTags: [...tags].sort() };
}
