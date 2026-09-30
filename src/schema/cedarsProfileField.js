// Sanity schema field for the auto-computed CEDARS+ typographic profile (engine v6).
// Read-only; populated on font upload by computeCedarsProfile (see utils).

// The continuous CEDARS scales, in canonical order — shared by scores/labels/availability. Order
// is load-bearing: it is the recall-vector dimension order, so these must stay in engine order.
//
// Renamed in engine v6: the stem-width scale was called `rhythm` and the spacing-regularity scale
// was called `pattern`, which had CEDARS' R pointing at the wrong measurement. Width is not one of
// the six letters and now sits under the "+"; Rhythm is regularity, which is what ILT means by R.
const SCALES = ['contrast', 'energy', 'width', 'rhythm', 'aperture'];

// The categorical CEDARS facets (soft-classified named qualities), in canonical order.
const FACETS = ['loops', 'terminals', 'transitions', 'fill', 'construction'];

// Build a title-cased label from a key (e.g. 'contrast' -> 'Contrast').
//
// The `rhythm -> Width` special case that used to live here is gone: it papered over the engine
// misnaming its own scale, and the rename removed the thing it was compensating for.
function titleCase(key) {
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
		'Auto-computed typographic profile from the font outlines: continuous scales (Contrast, Energy, Rhythm, Aperture, plus Width), a stress Axis angle, and categorical facets (Loops, Terminals, Transitions, Fill, Construction). Scores are NOT 0–100 — 0 and 100 are named landmark archetypes, so readings above 100 and below 0 are correct. Read-only; set on upload.',
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
			// The RAW measured quantities behind the scores. A score is (raw quantity) x (landmark
			// map); storing only the score fuses the two, so re-tuning a landmark would mean
			// re-parsing every font file — the cost that stops calibration ever happening. With
			// raws stored it is a pure re-map: read raw, apply the new map, write the score.
			//
			// Two scales store COMPONENTS rather than a composite, because their composite bakes in
			// a tunable constant: energy folds in springHeightWeight and rhythm folds in meanFloor.
			// Persisting the composite would force a reseed on any retune of either.
			//
			// A scale's key is present if and only if that scale was measurable; `axis` is always
			// present, and its null angle for a monoline face IS the measurement.
			title: 'Raw measurements',
			name: 'raw',
			type: 'object',
			options: { collapsible: true, collapsed: true },
			fields: [
				{
					title: 'Contrast',
					name: 'contrast',
					type: 'object',
					fields: [{ title: 'Thick/thin ratio', name: 'ratio', type: 'number' }],
				},
				{
					title: 'Energy',
					name: 'energy',
					type: 'object',
					fields: [
						{ title: 'Secant (deg)', name: 'secantDeg', type: 'number' },
						{ title: 'Spring height / x-height', name: 'springHeightRatio', type: 'number' },
					],
				},
				{
					title: 'Width',
					name: 'width',
					type: 'object',
					fields: [{ title: 'Width / x-height', name: 'widthRatio', type: 'number' }],
				},
				{
					title: 'Rhythm',
					name: 'rhythm',
					type: 'object',
					fields: [
						{ title: 'Pooled SD', name: 'pooledSd', type: 'number' },
						{ title: 'Mean budget', name: 'meanBudget', type: 'number' },
					],
				},
				{
					title: 'Aperture',
					name: 'aperture',
					type: 'object',
					fields: [{ title: 'Openness ratio', name: 'opennessRatio', type: 'number' }],
				},
				{
					title: 'Axis',
					name: 'axis',
					type: 'object',
					fields: [
						{ title: 'Angle (deg, null = monoline)', name: 'angleDeg', type: 'number' },
						{ title: 'Stress confidence', name: 'stressConfidence', type: 'number' },
					],
				},
			],
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
			// Recall vector [scoreToRecallDim(scale, score) …, sin2θ·conf, cos2θ·conf] — kept for
			// similarity search / export. Not scores/100: since engine v5 each score goes through a
			// shared squash so an unbounded reading cannot swamp the composite.
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
