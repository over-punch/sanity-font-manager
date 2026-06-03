// Tests for generateCssFile utility — buildVFDescriptors variable font axis logic
import { describe, it, expect } from 'vitest';
import { buildVFDescriptors } from '../utils/generateCssFile';

describe('buildVFDescriptors', () => {
	it('returns empty descriptors and skipped for null axis map', () => {
		const { descriptors, skipped } = buildVFDescriptors(null);
		expect(descriptors).toBe('');
		expect(skipped).toEqual([]);
	});

	it('maps wght axis to font-weight descriptor', () => {
		const { descriptors } = buildVFDescriptors({ wght: { min: 100, max: 900 } });
		expect(descriptors).toContain('font-weight:100 900');
	});

	it('maps wdth axis to font-stretch descriptor with clamping', () => {
		const { descriptors } = buildVFDescriptors({ wdth: { min: 75, max: 125 } });
		expect(descriptors).toContain('font-stretch:75% 125%');
	});

	it('clamps wdth to CSS range (50-200%)', () => {
		const { descriptors } = buildVFDescriptors({ wdth: { min: 30, max: 250 } });
		expect(descriptors).toContain('font-stretch:50% 200%');
	});

	it('maps slnt axis to oblique font-style with negated values', () => {
		const { descriptors } = buildVFDescriptors({ slnt: { min: -12, max: 0 } });
		// OpenType slnt -12..0 → CSS oblique 0deg 12deg (negated, ascending)
		expect(descriptors).toContain('font-style:oblique 0deg 12deg');
	});

	it('maps ital axis to italic when max > 0', () => {
		const { descriptors } = buildVFDescriptors({ ital: { min: 0, max: 1 } });
		expect(descriptors).toContain('font-style:italic');
	});

	it('skips ital axis when max === 0', () => {
		const { descriptors, skipped } = buildVFDescriptors({ ital: { min: 0, max: 0 } });
		expect(descriptors).not.toContain('font-style');
		expect(skipped).toContain('ital');
	});

	it('slnt takes priority over ital when both present', () => {
		const { descriptors } = buildVFDescriptors({ ital: { min: 0, max: 1 }, slnt: { min: -12, max: 0 } });
		expect(descriptors).toContain('oblique');
		expect(descriptors).not.toContain('font-style:italic');
	});

	it('skips degenerate axes where min === max', () => {
		const { descriptors, skipped } = buildVFDescriptors({ wght: { min: 400, max: 400 } });
		expect(descriptors).not.toContain('font-weight');
		expect(skipped).toContain('wght');
	});

	it('clamps axes where min > max', () => {
		const { descriptors } = buildVFDescriptors({ wght: { min: 900, max: 100 } });
		expect(descriptors).toContain('font-weight:100 900');
	});

	it('puts unknown axes (opsz, GRAD, custom) in the skipped list', () => {
		const { skipped } = buildVFDescriptors({ opsz: { min: 8, max: 144 }, GRAD: { min: -200, max: 150 } });
		expect(skipped).toContain('opsz');
		expect(skipped).toContain('GRAD');
	});

	it('handles multiple standard axes together', () => {
		const { descriptors } = buildVFDescriptors({ wght: { min: 100, max: 900 }, wdth: { min: 75, max: 125 } });
		expect(descriptors).toContain('font-weight:100 900');
		expect(descriptors).toContain('font-stretch:75% 125%');
	});

	it('returns empty descriptors for empty axis map', () => {
		const { descriptors } = buildVFDescriptors({});
		expect(descriptors).toBe('');
	});
});
