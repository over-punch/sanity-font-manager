// Tests for computeCedarsProfile and the cedarsPlus schema field — the persistence contract.
//
// The claim worth pinning is not "it returns an object" but that `raw` survives the wrapper intact.
// A score is (raw quantity) x (landmark map); storing only the score fuses the two, so a future
// landmark re-tune would mean re-parsing every font file instead of re-mapping stored numbers. The
// wrapper dropping `raw`, or inventing a key for an unmeasurable scale, both quietly restore that
// cost — and neither would fail any other test.
import { describe, it, expect, vi } from 'vitest';

import { cedarsProfileField } from '../schema/cedarsProfileField.js';

/** The five continuous scales, in the engine's canonical (recall-vector) order. */
const SCALES = ['contrast', 'energy', 'width', 'rhythm', 'aperture'];

/**
 * A profile shaped exactly as the engine returns one, with every scale measurable.
 * Values are a real reading (Jubilat Light) so the shape cannot drift from reality.
 */
function fullProfile() {
	return {
		scores: { contrast: 19, energy: 6, width: 4, rhythm: 77, aperture: 39 },
		labels: { contrast: 'low', energy: 'inert', width: 'normal', rhythm: 'even', aperture: 'moderate' },
		availability: { contrast: true, energy: true, width: true, rhythm: true, aperture: true },
		axis: { hasStress: true, angleDeg: 90.895, label: 'vertical', diagnostics: {} },
		facets: {
			loops: { top: 'oval', confidence: 0.7, dist: {} },
			terminals: { top: 'blunt', confidence: 0.6, dist: {} },
			transitions: { top: 'blended', confidence: 0.8, dist: {} },
			fill: { top: 'solid', confidence: 0.9, dist: {} },
			construction: { top: 'double-story', confidence: 0.75, dist: {} },
		},
		raw: {
			contrast: { ratio: 1.4110522496 },
			energy: { secantDeg: 27.411265596, springHeightRatio: 0.76984578728 },
			width: { widthRatio: 0.67774720502 },
			rhythm: { pooledSd: 0.01953727660, meanBudget: 0.08426501035 },
			aperture: { opennessRatio: 0.39248669699 },
			axis: { angleDeg: 90.895049389, stressConfidence: 0.89823493158 },
		},
		plus: { xHeightRatio: 0.52, capHeightRatio: 0.7, isMonospaced: false },
		vector: [0.19, 0.06, 0.52, 0.77, 0.39, 0.9, 0.01],
		diagnostics: {},
		facetDiagnostics: {},
	};
}

/**
 * Load computeCedarsProfile with the engine stubbed to return a given profile.
 *
 * @param {object} profile - what analyzeFont should return
 */
async function withEngine(profile) {
	vi.resetModules();
	vi.doMock('@overpunch/cedars-engine', () => ({
		analyzeFont: () => profile,
		CEDARS_FACETS: ['loops', 'terminals', 'transitions', 'fill', 'construction'],
	}));
	const mod = await import('../utils/computeCedarsProfile.js');
	return mod.computeCedarsProfile(new Uint8Array([0]));
}

describe('computeCedarsProfile', () => {
	it('persists raw, so a landmark re-tune is a re-map rather than a reseed', async () => {
		const out = await withEngine(fullProfile());
		expect(out.raw).toBeDefined();
		expect(out.raw.contrast.ratio).toBeCloseTo(1.4110522496, 9);
	});

	it('keeps raw at full precision rather than rounding it to the score', async () => {
		// The whole point of storing raws is that they carry more information than the rounded
		// score. Truncating them here would leave the re-map no better off than the score alone.
		const out = await withEngine(fullProfile());
		expect(out.raw.rhythm.pooledSd).not.toBe(0);
		expect(String(out.raw.aperture.opennessRatio)).toContain('.3924866');
	});

	it('stores components, not composites, for the two scales that fold in a tunable', async () => {
		// energy folds springHeightWeight and rhythm folds meanFloor into their composites, so the
		// pieces must survive — otherwise retuning either constant forces a reseed.
		const out = await withEngine(fullProfile());
		expect(Object.keys(out.raw.energy).sort()).toEqual(['secantDeg', 'springHeightRatio']);
		expect(Object.keys(out.raw.rhythm).sort()).toEqual(['meanBudget', 'pooledSd']);
	});

	it('omits an unmeasurable scale from raw instead of fabricating a key', async () => {
		// An unavailable scale's diagnostics hold placeholders. Persisting one as a "raw
		// measurement" stores a placeholder as though it were a reading — the exact lie the
		// present-if-and-only-if-available contract exists to prevent.
		const p = fullProfile();
		p.availability.rhythm = false;
		delete p.raw.rhythm;
		const out = await withEngine(p);
		expect('rhythm' in out.raw).toBe(false);
		expect(out.availability.rhythm).toBe(false);
	});

	it('keeps the monoline axis angle as null rather than coercing it to a number', async () => {
		// `hasStress: false` with a null angle IS the measurement for a monoline face; a 0 would
		// read as "vertical-ish stress".
		const p = fullProfile();
		p.axis = { hasStress: false, angleDeg: null, label: 'monoline', diagnostics: {} };
		p.raw.axis = { angleDeg: null, stressConfidence: 0 };
		const out = await withEngine(p);
		expect(out.raw.axis.angleDeg).toBeNull();
		expect(out.axis.angleDeg).toBeNull();
	});

	it('flattens each facet to class and confidence only', async () => {
		const out = await withEngine(fullProfile());
		expect(Object.keys(out.facets.loops).sort()).toEqual(['confidence', 'top']);
	});
});

describe('cedarsPlus schema field', () => {
	it('declares a raw group, or the computed raws have nowhere to land', async () => {
		const raw = cedarsProfileField.fields.find((f) => f.name === 'raw');
		expect(raw).toBeDefined();
		expect(raw.type).toBe('object');
	});

	it('covers every key the engine actually emits in raw', async () => {
		// The drift guard: if the engine adds or renames a raw key, this fails rather than silently
		// discarding the new measurement on write.
		const raw = cedarsProfileField.fields.find((f) => f.name === 'raw');
		const declared = raw.fields.map((f) => f.name).sort();
		const emitted = Object.keys(fullProfile().raw).sort();
		expect(declared).toEqual(emitted);
	});

	it('declares each raw scale\'s own component fields', async () => {
		const raw = cedarsProfileField.fields.find((f) => f.name === 'raw');
		const sub = (name) => raw.fields.find((f) => f.name === name).fields.map((f) => f.name).sort();
		const emitted = fullProfile().raw;
		for (const key of Object.keys(emitted)) {
			expect(sub(key), key).toEqual(Object.keys(emitted[key]).sort());
		}
	});

	it('uses the engine scale vocabulary, with rhythm meaning regularity and width under the plus', async () => {
		// Guards the v6 rename from regressing: a `pattern` key here would mean the schema and the
		// engine disagree about what R measures.
		const scores = cedarsProfileField.fields.find((f) => f.name === 'scores');
		expect(scores.fields.map((f) => f.name)).toEqual(SCALES);
		expect(scores.fields.map((f) => f.name)).not.toContain('pattern');
	});

	it('does not tell editors the scores are 0-100', async () => {
		// They have been unbounded since engine v5 — 0 and 100 are named landmarks, so a reading of
		// 113 is correct. The description asserted the old range long after it stopped being true.
		expect(cedarsProfileField.description).not.toMatch(/0[–-]100\)/);
		expect(cedarsProfileField.description).toMatch(/NOT 0[–-]100/);
	});
});
