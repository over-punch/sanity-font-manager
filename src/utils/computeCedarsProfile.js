// Computes a font's CEDARS+ profile from its raw bytes, shaped for the Sanity
// `cedarsPlus` field. Thin wrapper around @liiift-studio/cedars-engine (v3).
import { analyzeFont, CEDARS_FACETS } from '@liiift-studio/cedars-engine';

/**
 * Compute the CEDARS+ profile for a font from its raw outline geometry. v3 models CEDARS as
 * continuous scales (Contrast, Energy, Rhythm/width, Pattern, Aperture), a stress ANGLE, and
 * categorical facet classifiers (Loops, Terminals, Transitions, Fill, Construction).
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
