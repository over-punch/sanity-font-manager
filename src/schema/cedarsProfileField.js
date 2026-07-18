// Sanity schema field for the auto-computed CEDARS+ typographic profile (v3).
// Read-only; populated on font upload by computeCedarsProfile (see utils).

// The continuous CEDARS scales, in canonical order — shared by scores/labels/availability.
const SCALES = ['contrast', 'energy', 'rhythm', 'pattern', 'aperture'];

// The categorical CEDARS facets (soft-classified named qualities), in canonical order.
const FACETS = ['loops', 'terminals', 'transitions', 'fill', 'construction'];

// Build a title-cased label from a key (e.g. 'contrast' -> 'Contrast'; 'rhythm' -> 'Width').
function titleCase(key) {
	if (key === 'rhythm') return 'Width';
	return key.charAt(0).toUpperCase() + key.slice(1);
}

// Number sub-fields (0..100) for each scale, used by the scores group.
const scoreFields = SCALES.map((key) => ({
	title: titleCase(key),
	name: key,
	type: 'number',
}));

// String sub-fields (human-readable descriptor) for each scale, used by the labels group.
const labelFields = SCALES.map((key) => ({
	title: titleCase(key),
	name: key,
	type: 'string',
}));

// Per-facet object sub-field: the predicted class + its confidence.
const facetFields = FACETS.map((key) => ({
	title: titleCase(key),
	name: key,
	type: 'object',
	options: { collapsible: false },
	fields: [
		{ title: 'Class', name: 'top', type: 'string' },
		{ title: 'Confidence', name: 'confidence', type: 'number' },
	],
}));

// The CEDARS+ profile field definition. Attach to a `font` document schema.
export const cedarsProfileField = {
	title: 'CEDARS+ Profile',
	name: 'cedarsPlus',
	type: 'object',
	description:
		'Auto-computed typographic profile from the font outlines (v3): continuous scales (Contrast, Energy, Width, Pattern, Aperture, 0–100), a stress Axis angle, and categorical facets (Loops, Terminals, Transitions, Fill, Construction). Read-only; set on upload.',
	readOnly: true,
	options: { collapsible: true, collapsed: true },
	fields: [
		{
			title: 'Scores',
			name: 'scores',
			type: 'object',
			options: { collapsible: true, collapsed: false },
			fields: scoreFields,
		},
		{
			title: 'Labels',
			name: 'labels',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: labelFields,
		},
		{
			// Per-scale measurability: false means the scale could not be measured for this
			// font (a 0 score is a placeholder, not a real low reading).
			title: 'Availability',
			name: 'availability',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: SCALES.map((key) => ({ title: titleCase(key), name: key, type: 'boolean' })),
		},
		{
			// The stress axis as an ANGLE, with an explicit monoline (no-stress) state.
			title: 'Axis (stress angle)',
			name: 'axis',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: [
				{ title: 'Has stress', name: 'hasStress', type: 'boolean' },
				{ title: 'Angle (deg, 0..180; 90 = vertical)', name: 'angleDeg', type: 'number' },
				{ title: 'Label', name: 'label', type: 'string' },
			],
		},
		{
			// Categorical facet classifications (predicted class + confidence each).
			title: 'Facets',
			name: 'facets',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: facetFields,
		},
		{
			title: '+ Descriptors',
			name: 'plus',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: [
				{ title: 'x-height / cap-height', name: 'xHeightRatio', type: 'number' },
				{ title: 'cap-height / em', name: 'capHeightRatio', type: 'number' },
				{ title: 'Monospaced', name: 'isMonospaced', type: 'boolean' },
			],
		},
		{
			// Recall vector [scales/100 …, sin2θ, cos2θ] — kept for similarity search / export.
			title: 'Vector',
			name: 'vector',
			type: 'array',
			of: [{ type: 'number' }],
		},
	],
};

/**
 * Factory to create a customised CEDARS+ profile field.
 * @param {object} [options]
 * @param {boolean} [options.readOnly=true] - Whether the field is read-only in the Studio.
 * @param {string} [options.group] - Optional field group to assign the field to.
 * @returns {object} Sanity field definition
 */
export function createCedarsProfileField({ readOnly = true, group } = {}) {
	const field = { ...cedarsProfileField, readOnly };
	if (group) field.group = group;
	return field;
}
