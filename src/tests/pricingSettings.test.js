// Tests for the per-style pricing opt-out — in particular that `sell` is decoupled from a hidden price
import { describe, it, expect } from 'vitest';

import { createEmptyPlan } from '../utils/planTypes.js';

/**
 * Mirrors the price/sell decision made when creating a font document in executeUploadPlan.
 * Kept in step with that write; see the comment there.
 */
const writeFor = (settings) => ({
	price: settings.pricing === false ? 0 : settings.price,
	sell: settings.pricing === false ? settings.sell !== false : settings.price > 0,
});

describe('pricing settings', () => {
	it('defaults to pricing on and sell true', () => {
		const { settings } = createEmptyPlan();
		expect(settings.pricing).toBe(true);
		expect(settings.sell).toBe(true);
		expect(settings.price).toBe(0);
	});

	it('keeps the historical behaviour when pricing is on', () => {
		expect(writeFor({ pricing: true, price: 40, sell: true })).toEqual({ price: 40, sell: true });
		// A zero price with pricing ON still means "not for sale", as before.
		expect(writeFor({ pricing: true, price: 0, sell: true })).toEqual({ price: 0, sell: false });
	});

	it('does NOT derive sell from the price when pricing is off', () => {
		// The regression this guards: hiding the price left it at 0, so every newly uploaded font was
		// written with sell:false and silently lost its type-tester buy button.
		expect(writeFor({ pricing: false, price: 0, sell: true })).toEqual({ price: 0, sell: true });
	});

	it('honours an explicit sell:false when pricing is off', () => {
		expect(writeFor({ pricing: false, price: 0, sell: false })).toEqual({ price: 0, sell: false });
	});

	it('ignores any stale price once pricing is off', () => {
		expect(writeFor({ pricing: false, price: 40, sell: true })).toEqual({ price: 0, sell: true });
	});

	it('treats an omitted sell as true when pricing is off', () => {
		expect(writeFor({ pricing: false, price: 0 })).toEqual({ price: 0, sell: true });
	});

	it('carries the opt-out through createEmptyPlan', () => {
		const { settings } = createEmptyPlan({ pricing: false, sell: true });
		expect(settings.pricing).toBe(false);
		expect(writeFor(settings)).toEqual({ price: 0, sell: true });
	});
});
