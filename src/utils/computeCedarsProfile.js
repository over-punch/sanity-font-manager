// Computes a font's CEDARS+ profile from its raw bytes, shaped for the Sanity
// `cedarsPlus` field. Thin wrapper around @liiift-studio/cedars-engine.
import { analyzeFont } from '@liiift-studio/cedars-engine';

/**
 * Compute the CEDARS+ profile (Contrast, Energy, Details, Axis, Rhythm, Structure)
 * for a font from its raw outline geometry.
 * @param {ArrayBuffer} buffer - The font file bytes (OTF/TTF/WOFF).
 * @returns {{ scores: object, labels: object, plus: object, vector: number[] }}
 */
export function computeCedarsProfile(buffer) {
	const profile = analyzeFont(buffer);
	return {
		scores: profile.scores,
		labels: profile.labels,
		plus: profile.plus,
		vector: profile.vector,
	};
}
