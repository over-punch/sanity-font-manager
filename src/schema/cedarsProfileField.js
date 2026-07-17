// Sanity schema field for the auto-computed CEDARS+ typographic profile.
// Read-only; populated on font upload by computeCedarsProfile (see utils).

// The six CEDARS axes, in canonical order — shared by the scores and labels groups.
const AXES = ['contrast', 'energy', 'details', 'axis', 'rhythm', 'structure'];

// Build a title-cased label from an axis key (e.g. 'contrast' -> 'Contrast').
function titleCase(key) {
	return key.charAt(0).toUpperCase() + key.slice(1);
}

// Number sub-fields (0..100) for each axis, used by the scores group.
const scoreFields = AXES.map((key) => ({
	title: titleCase(key),
	name: key,
	type: 'number',
}));

// String sub-fields (human-readable descriptor) for each axis, used by the labels group.
const labelFields = AXES.map((key) => ({
	title: titleCase(key),
	name: key,
	type: 'string',
}));

// The CEDARS+ profile field definition. Attach to a `font` document schema.
export const cedarsProfileField = {
	title: 'CEDARS+ Profile',
	name: 'cedarsPlus',
	type: 'object',
	description:
		'Auto-computed typographic profile from the font outlines — Contrast, Energy, Details, Axis, Rhythm, Structure (0–100 each). Read-only; set on upload.',
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
			// Normalized [C,E,D,A,R,S] 0..1 vector — kept for similarity search / export.
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
