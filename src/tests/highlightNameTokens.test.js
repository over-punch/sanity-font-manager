// Tests for tokenizeName / subfamilyHue — the word-level highlighting of font names in the upload wizard
import { describe, it, expect } from 'vitest';

import { tokenizeName, subfamilyHue } from '../utils/highlightNameTokens.js';

/** Rebuilds the original string from tokens, to prove nothing is lost or reordered */
const rebuild = (tokens) => tokens.map((t) => t.text).join('');
/** Returns the text of every token with a given role */
const roled = (tokens, role) => tokens.filter((t) => t.role === role).map((t) => t.text);

describe('tokenizeName', () => {
	it('reproduces the original name exactly, spacing included', () => {
		const name = 'Daith  Big Bold Italic';
		expect(rebuild(tokenizeName(name, 'Big'))).toBe(name);
	});

	it('marks the subfamily word and the slant word', () => {
		const tokens = tokenizeName('Daith Big Bold Italic', 'Big');
		expect(roled(tokens, 'subfamily')).toEqual(['Big']);
		expect(roled(tokens, 'italic')).toEqual(['Italic']);
		expect(roled(tokens, 'plain').join('').trim()).toContain('Daith');
	});

	it('keeps a multi-word subfamily intact', () => {
		const tokens = tokenizeName('Corundum Text Advanced Bold', 'Text Advanced');
		expect(roled(tokens, 'subfamily')).toEqual(['Text', 'Advanced']);
	});

	it('picks the longest matching candidate from a list', () => {
		const tokens = tokenizeName('Corundum Text Advanced Bold', ['Text', 'Text Advanced']);
		expect(roled(tokens, 'subfamily')).toEqual(['Text', 'Advanced']);
	});

	it('matches the subfamily case-insensitively but preserves the original casing', () => {
		const tokens = tokenizeName('Daith BIG Bold', 'big');
		expect(roled(tokens, 'subfamily')).toEqual(['BIG']);
	});

	it('does not match a subfamily inside a longer word', () => {
		// "Big" must not match inside "Bigger".
		const tokens = tokenizeName('Daith Bigger Bold', 'Big');
		expect(roled(tokens, 'subfamily')).toEqual([]);
	});

	it('recognises oblique and abbreviated slant words', () => {
		expect(roled(tokenizeName('Family Oblique'), 'italic')).toEqual(['Oblique']);
		expect(roled(tokenizeName('Family It'), 'italic')).toEqual(['It']);
	});

	it('tags a slant word carrying punctuation', () => {
		expect(roled(tokenizeName('Family Bold-Italic,'), 'italic')).toEqual([]);
		expect(roled(tokenizeName('Family Italic,'), 'italic')).toEqual(['Italic,']);
	});

	it('handles a missing subfamily, an empty name, and no arguments', () => {
		expect(roled(tokenizeName('Daith Bold Italic'), 'subfamily')).toEqual([]);
		expect(tokenizeName('')).toEqual([]);
		expect(tokenizeName()).toEqual([]);
	});

	it('ignores blank candidates in a list', () => {
		const tokens = tokenizeName('Daith Big Bold', ['', null, undefined, 'Big']);
		expect(roled(tokens, 'subfamily')).toEqual(['Big']);
	});

	it('does not treat a regex-special subfamily as a pattern', () => {
		const tokens = tokenizeName('Daith (Pro) Bold', '(Pro)');
		expect(roled(tokens, 'subfamily')).toEqual(['(Pro)']);
	});
});

describe('subfamilyHue', () => {
	it('is stable for the same subfamily', () => {
		expect(subfamilyHue('Big')).toBe(subfamilyHue('Big'));
	});

	it('separates common sibling subfamilies', () => {
		const hues = ['Big', 'Text', 'Display', 'Caption', 'Small'].map(subfamilyHue);
		expect(new Set(hues).size).toBe(hues.length);
	});

	it('always returns a valid hue', () => {
		for (const value of ['', 'Big', 'Text Advanced', undefined]) {
			const hue = subfamilyHue(value);
			expect(hue).toBeGreaterThanOrEqual(0);
			expect(hue).toBeLessThan(360);
		}
	});
});
