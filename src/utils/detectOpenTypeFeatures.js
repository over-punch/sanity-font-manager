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
 * Merges one font document's stored feature labels into the family-wide tag → label map.
 *
 * Styles can disagree: a family may name `ss01` "Alternate g" on the roman and leave it unnamed on
 * the italic. The first style to name a tag wins, and the caller feeds variable fonts in first, so
 * the VF's labels beat the statics' — see `orderByAuthority`.
 *
 * @param {object} doc - font document projected with `opentypeFeatures`
 * @param {Map<string, string>} names - accumulator, mutated in place
 * @returns {void}
 */
function collectFeatureNames(doc, names) {
	const featureList = doc?.opentypeFeatures?.featureList;
	if (!Array.isArray(featureList)) return;

	for (const entry of featureList) {
		const tag = typeof entry?.tag === 'string' ? entry.tag.trim() : '';
		const title = typeof entry?.title === 'string' ? entry.title.trim() : '';
		if (tag && title && !names.has(tag)) names.set(tag, title);
	}
}

/**
 * Orders styles so the family's variable font is consulted first.
 *
 * A VF is the whole family in one binary, so its labels are the family's labels — where a static
 * style is one cut whose names may lag a re-release, or be missing because nobody rebuilt it. The
 * statics still follow, filling in any tag the VF does not name, so a partially rebuilt family
 * keeps working.
 *
 * The sort is stable, so styles that are not variable keep their `styles.fonts` order relative to
 * each other, and a family with no VF behaves exactly as before.
 *
 * @param {object[]} docs - deduped font documents, projected with `variableFont`
 * @returns {object[]} the same documents, variable fonts first
 */
function orderByAuthority(docs) {
	return [...docs].sort((a, b) => (b?.variableFont === true) - (a?.variableFont === true));
}

/**
 * Collects the union of OpenType layout tags across every supplied font document, along with any
 * foundry-authored labels those styles carry for their stylistic sets and character variants.
 *
 * A family's styles rarely agree — italics routinely drop stylistic sets the romans carry — so the
 * union answers "what can this typeface do", which is what a family-level field describes.
 *
 * Labels are read variable-font-first — see `orderByAuthority`.
 *
 * @param {object[]} fontDocs - font documents projected with `_id`, `variableFont`, `opentypeFeatures`
 * @returns {{tags: Set<string>, names: Map<string, string>, fontsWithData: number}} union of tags,
 *   tag → font-supplied label, and how many styles carried any feature data
 */
export function collectSupportedTags(fontDocs = []) {
	const tags = new Set();
	const names = new Map();
	let fontsWithData = 0;

	for (const doc of orderByAuthority(dedupeFontDocs(fontDocs))) {
		// Labels are gathered before the `chars` gate: a style whose feature list survived a partial
		// upload can still name a set another style contributes the tag for.
		collectFeatureNames(doc, names);

		const chars = doc?.opentypeFeatures?.chars;
		if (!Array.isArray(chars) || chars.length === 0) continue;
		fontsWithData++;
		for (const tag of chars) {
			if (typeof tag !== 'string') continue;
			const trimmed = tag.trim();
			if (trimmed) tags.add(trimmed);
		}
	}

	return { tags, names, fontsWithData };
}

/**
 * Picks the title for a detected feature.
 *
 * A stored title that is neither empty nor the canonical fallback is an editor's own wording, and
 * outranks the font — re-running detection must never overwrite what somebody typed. Everything
 * else is ours to fill: the font's own label wins, and the canonical title is the last resort.
 *
 * The cost of not recording where a title came from: once a font label lands in the document it
 * reads as editor wording on the next run, so re-uploading a font that renames the set will not
 * overwrite it. Clearing the title field and detecting again picks the new name up.
 *
 * @param {string} [storedTitle] - title currently on the feature's sub-object
 * @param {string} canonicalTitle - the OPENTYPE_FEATURE_TAGS fallback, e.g. 'Stylistic Set 1'
 * @param {string} [fontTitle] - label the font supplied for this feature, if any
 * @returns {string} the title to write
 */
function chooseTitle(storedTitle, canonicalTitle, fontTitle) {
	const stored = typeof storedTitle === 'string' ? storedTitle.trim() : '';
	if (stored && stored !== canonicalTitle) return stored;
	return fontTitle || canonicalTitle;
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
 * Titles the foundry authored in the font win over the canonical ones: `OPENTYPE_FEATURE_TAGS`
 * can only offer "Stylistic Set 1", while the font may well say "Alternate g". See `chooseTitle`
 * for how that is reconciled against a title an editor typed.
 *
 * @param {object[]} fontDocs - font documents projected with `opentypeFeatures`
 * @param {object} value - current value of the openType object field
 * @returns {{features: string[], detected: object, fontsWithData: number, namedFeatures: number, supportedTags: string[]}}
 */
export function detectOpenTypeFeatures(fontDocs = [], value = {}) {
	const { tags, names, fontsWithData } = collectSupportedTags(fontDocs);
	const features = [];
	const detected = {};
	let namedFeatures = 0;

	for (const [key, meta] of Object.entries(OPENTYPE_FEATURE_TAGS)) {
		const required = meta.feature.split(' ').filter(Boolean);
		if (required.length === 0) continue;
		if (!required.every((tag) => tags.has(tag))) continue;

		// Only a single-tag feature can inherit a name. Combinations like 'pnum onum', and the whole
		// ss01–ss20 run behind `allStylisticSets`, are our groupings — the font never labels them.
		const fontTitle = required.length === 1 ? names.get(required[0]) : undefined;
		const existing = value?.[key] || {};
		const title = chooseTitle(existing.title, meta.title, fontTitle);
		if (fontTitle && title === fontTitle) namedFeatures++;

		features.push(key);
		detected[key] = {
			...existing,
			title,
			feature: meta.feature,
		};
	}

	return { features, detected, fontsWithData, namedFeatures, supportedTags: [...tags].sort() };
}
