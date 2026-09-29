// Computes a font's CEDARS+ profile from its raw bytes, shaped for the Sanity
// `cedarsPlus` field. Thin wrapper around @overpunch/cedars-engine (v6).
import { analyzeFont, CEDARS_FACETS } from '@overpunch/cedars-engine';

/**
 * Compute the CEDARS+ profile for a font from its raw outline geometry. The engine models CEDARS as
 * continuous scales (Contrast, Energy, Rhythm = spacing regularity, Aperture, plus Width under the
 * "+"), a stress ANGLE, and categorical facet classifiers (Loops, Terminals, Transitions, Fill,
 * Construction).
 *
 * NOTE: scores are UNBOUNDED since engine v5 — 0 and 100 are named landmark archetypes, not limits,
 * so 113 and -129 are correct readings. Never clamp or range-validate them.
 *
 * NOTE: this does not yet persist `profile.raw`, which the engine added in v5 so that a landmark
 * re-tune is a re-map rather than a full re-parse of every font file. Adding it needs a matching
 * schema field; until then a recalibration costs a reseed here.
 * @param {ArrayBuffer|Uint8Array} buffer - The font file bytes (OTF/TTF/WOFF; not WOFF2).
 * @returns {{ scores: object, labels: object, availability: object, axis: object, facets: object, plus: object, vector: number[] }}
 */
export function computeCedarsProfile(buffer) {
	const profile = analyzeFont(buffer);
	// Flatten each facet's soft classifier result to { top, confidence } for the Sanity schema.
	const facets = {};
	for (const f of CEDARS_FACETS) {
		const facet = profile.facets[f];
		facets[f] = { top: facet.top, confidence: facet.confidence };
	}
	return {
		scores: profile.scores,
		labels: profile.labels,
		availability: profile.availability,
		axis: { hasStress: profile.axis.hasStress, angleDeg: profile.axis.angleDeg, label: profile.axis.label },
		facets,
		plus: profile.plus,
		vector: profile.vector,
	};
}
