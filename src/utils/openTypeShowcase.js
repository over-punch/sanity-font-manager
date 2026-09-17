// Pure helpers that tie an OpenType showcase card to the typeface's detected openType features — no Studio or React imports

import { OPENTYPE_FEATURE_TAGS } from '../schema/openTypeFeatureTags.js';

/**
 * Turns an openType `feature` value into a CSS font-feature-settings string.
 * Space-separated tags are all switched on: 'tnum lnum' → "'tnum' 1, 'lnum' 1".
 * @param {string} [feature] - one or more space-separated OpenType tags
 * @returns {string} CSS value, or '' when there are no tags
 */
export function featureTagsToCss(feature) {
	return String(feature || '')
		.split(/\s+/)
		.filter(Boolean)
		.map((tag) => `'${tag}' 1`)
		.join(', ');
}

/**
 * Reads the tags a CSS font-feature-settings string switches ON, lowercased and in order.
 * Tags set to 0 or off are skipped — "'liga' 0" names a feature being disabled, not shown.
 * @param {string} [css] - e.g. "'c2sc' 1, 'smcp' 1"
 * @returns {string[]} e.g. ['c2sc', 'smcp']
 */
export function cssToFeatureTags(css) {
	const tags = [];
	const pattern = /['"]([A-Za-z0-9]{4})['"]\s*([A-Za-z0-9]+)?/g;
	for (const match of String(css || '').matchAll(pattern)) {
		const state = (match[2] || '1').toLowerCase();
		if (state === '0' || state === 'off') continue;
		tags.push(match[1].toLowerCase());
	}
	return tags;
}

/**
 * Lists the features an openType field value has marked as detected, in stored order.
 * The reviewed title and tag on the feature's sub-object win; the canonical map fills any gap.
 * @param {object} [openType] - value of the openType field
 * @returns {{key: string, title: string, feature: string}[]}
 */
export function listDetectedFeatures(openType) {
	const keys = Array.isArray(openType?.features) ? openType.features : [];
	return keys
		.filter((key) => typeof key === 'string' && key)
		.map((key) => ({
			key,
			title: openType?.[key]?.title?.trim() || OPENTYPE_FEATURE_TAGS[key]?.title || key,
			feature: openType?.[key]?.feature?.trim() || OPENTYPE_FEATURE_TAGS[key]?.feature || '',
		}));
}

/**
 * Finds the detected feature whose tags are exactly the tags a legacy CSS string switches on.
 * Exact set equality only — "'tnum' 1" does not claim 'tnum lnum', because a typeface can detect
 * both Tabular Lining and Tabular Oldstyle and a guess would silently change what renders.
 * @param {string} css - legacy font-feature-settings value
 * @param {object} openType - value of the openType field
 * @returns {string|null} the openType feature key, or null when nothing matches exactly
 */
export function matchFeatureKey(css, openType) {
	const wanted = [...new Set(cssToFeatureTags(css))].sort().join(' ');
	if (!wanted) return null;
	for (const { key, feature } of listDetectedFeatures(openType)) {
		const have = [...new Set(feature.toLowerCase().split(/\s+/).filter(Boolean))].sort().join(' ');
		if (have === wanted) return key;
	}
	return null;
}

/**
 * Resolves what a showcase card displays: its label and the CSS that switches its feature on.
 *
 * - `label`: the card's own label is an override; blank falls back to the reviewed openType title.
 * - `css`: `specialtyCss` is an override; otherwise the picked feature's tags; otherwise the legacy
 *   `stylisticFeature` string, so cards authored before the picker existed keep rendering.
 *
 * A picked key that is no longer in `features` still resolves through the canonical map — the page
 * should not lose a demo because detection was re-run — and reports `detected: false` so the Studio
 * can flag it.
 *
 * @param {object} card - showcase array member
 * @param {object} [openType] - value of the openType field
 * @returns {{key: string|null, detected: boolean, label: string, css: string}}
 */
export function resolveShowcaseCard(card, openType) {
	const key = typeof card?.feature === 'string' && card.feature ? card.feature : null;
	const stored = key ? openType?.[key] : null;
	const canonical = key ? OPENTYPE_FEATURE_TAGS[key] : null;
	const detected = !!key && Array.isArray(openType?.features) && openType.features.includes(key);

	const title = stored?.title?.trim() || canonical?.title || '';
	const tags = stored?.feature?.trim() || canonical?.feature || '';

	return {
		key,
		detected,
		label: card?.label?.trim() || title,
		css: card?.specialtyCss?.trim() || featureTagsToCss(tags) || card?.stylisticFeature?.trim() || '',
	};
}
