// Tests for buildVariableInstances — mapping named-instance coordinates to axis tags in full fvar order.
import { describe, it, expect } from 'vitest';
import { buildVariableInstances } from '../utils/generateFontData';

/** Minimal font stub exposing only the fvar axes buildVariableInstances reads. */
function fontWith(axes) {
	return { opentype: { tables: { fvar: { axes } } } };
}

describe('buildVariableInstances', () => {
	it('maps coordinates by FULL fvar order when a leading axis is pinned (dropped from variableAxes)', () => {
		// fvar order: opsz (pinned 14→14, dropped), wght (real). Instance coords are in full fvar order.
		const font = fontWith([
			{ tag: 'opsz', minValue: 14, maxValue: 14 },
			{ tag: 'wght', minValue: 100, maxValue: 900 },
		]);
		const variableAxes = { wght: { min: 100, max: 900, default: 400 } }; // opsz dropped as degenerate
		const namedInstances = [{ name: 'Bold', coordinates: [14, 700], postScriptName: 'X-Bold' }];

		const result = buildVariableInstances(font, variableAxes, namedInstances);

		// The wght value must be 700 (coordinates[1]), NOT 14 (the pinned opsz at coordinates[0]).
		expect(result).toEqual({ Bold: { wght: 700 } });
		expect(result.Bold).not.toHaveProperty('opsz');
	});

	it('maps all axes correctly when none are pinned', () => {
		const font = fontWith([
			{ tag: 'wght', minValue: 100, maxValue: 900 },
			{ tag: 'ital', minValue: 0, maxValue: 1 },
		]);
		const variableAxes = { wght: {}, ital: {} };
		const namedInstances = [
			{ name: 'Regular', coordinates: [400, 0] },
			{ name: 'Bold Italic', coordinates: [700, 1] },
		];

		expect(buildVariableInstances(font, variableAxes, namedInstances)).toEqual({
			Regular: { wght: 400, ital: 0 },
			'Bold Italic': { wght: 700, ital: 1 },
		});
	});

	it('falls back to postScriptName, then "Unknown", for the instance key', () => {
		const font = fontWith([{ tag: 'wght', minValue: 100, maxValue: 900 }]);
		const variableAxes = { wght: {} };
		const result = buildVariableInstances(font, variableAxes, [
			{ name: '', coordinates: [500], postScriptName: 'Fam-Medium' },
			{ name: null, coordinates: [800], postScriptName: '' },
		]);
		expect(result).toHaveProperty('Fam-Medium', { wght: 500 });
		expect(result).toHaveProperty('Unknown', { wght: 800 });
	});

	it('returns null when there are no named instances or no axes', () => {
		const font = fontWith([{ tag: 'wght', minValue: 100, maxValue: 900 }]);
		expect(buildVariableInstances(font, { wght: {} }, [])).toBeNull();
		expect(buildVariableInstances(font, null, [{ name: 'R', coordinates: [400] }])).toBeNull();
	});

	it('falls back to positional mapping over kept axes when coordinate/axis lengths disagree', () => {
		// Degenerate/unexpected: instance has fewer coords than fvar axes → positional over kept tags.
		const font = fontWith([
			{ tag: 'wght', minValue: 100, maxValue: 900 },
			{ tag: 'wdth', minValue: 75, maxValue: 125 },
		]);
		const variableAxes = { wght: {}, wdth: {} };
		const result = buildVariableInstances(font, variableAxes, [{ name: 'R', coordinates: [400] }]);
		expect(result.R.wght).toBe(400);
	});
});
