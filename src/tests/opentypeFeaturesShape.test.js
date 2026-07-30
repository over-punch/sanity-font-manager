// Guards that every writer of font.opentypeFeatures uses the schema's object-with-chars shape, not a bare array
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { detectOpenTypeFeatures } from '../utils/detectOpenTypeFeatures.js';

/** Reads a source file from src/ as text, for shape assertions that would need a browser font parser otherwise */
const source = (relative) => readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

describe('font.opentypeFeatures shape', () => {
	it('is never assigned a bare array in buildUploadPlan', () => {
		// A bare array reaches the document unchanged when metadata generation is skipped (WOFF2-only
		// uploads have no TTF/OTF), and every reader looks for `.chars`.
		const text = source('utils/buildUploadPlan.js');
		const assignments = text.match(/opentypeFeatures:.*/g) || [];
		expect(assignments.length).toBeGreaterThan(0);
		for (const line of assignments) {
			expect(line, `bare array assignment: ${line.trim()}`).toMatch(/opentypeFeatures:\s*\{/);
		}
	});

	it('is object-wrapped in generateFontData', () => {
		const assignments = source('utils/generateFontData.js').match(/opentypeFeatures:.*/g) || [];
		for (const line of assignments) {
			expect(line).toMatch(/opentypeFeatures:\s*\{\s*chars/);
		}
	});

	it('detection finds nothing when handed the legacy bare-array shape', () => {
		// Documents written by the old code path are unreadable — this is the symptom to recognise.
		const legacy = [{ _id: 'a', opentypeFeatures: ['liga', 'dlig'] }];
		expect(detectOpenTypeFeatures(legacy, {}).fontsWithData).toBe(0);

		const correct = [{ _id: 'a', opentypeFeatures: { chars: ['liga', 'dlig'] } }];
		expect(detectOpenTypeFeatures(correct, {}).fontsWithData).toBe(1);
	});
});
