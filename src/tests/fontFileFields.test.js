// Tests for createFontFileFields — the shared fileInput shape every foundry schema spreads
import { describe, it, expect } from 'vitest';
import { createFontFileFields, FONT_FILE_FORMATS } from '../schema/fontFileFields';

/** Field names in order, for shape assertions */
const namesOf = (field) => field.fields.map(f => f.name);

describe('createFontFileFields', () => {
	it('emits every delivery and derived format in a stable order', () => {
		expect(namesOf(createFontFileFields())).toEqual([
			'ttf', 'otf', 'woff', 'woff2', 'eot', 'svg', 'css', 'woff2_subset', 'woff2_web',
		]);
	});

	it('defaults to an object field named fileInput', () => {
		const field = createFontFileFields();
		expect(field.name).toBe('fileInput');
		expect(field.type).toBe('object');
		expect(field.title).toBe('Files');
	});

	it('omits the derived files when the site cannot generate them', () => {
		const names = namesOf(createFontFileFields({ derived: false }));
		expect(names).not.toContain('woff2_subset');
		expect(names).not.toContain('woff2_web');
		expect(names).toContain('woff2');
	});

	it('restricts the TTF field to .ttf so the conversion source cannot be mis-uploaded', () => {
		const ttf = createFontFileFields().fields.find(f => f.name === 'ttf');
		expect(ttf.options).toEqual({ accept: '.ttf' });
	});

	it('describes the derived files so curators know not to fill them by hand', () => {
		const fields = createFontFileFields().fields;
		expect(fields.find(f => f.name === 'woff2_subset').description).toMatch(/Auto-generated/);
		expect(fields.find(f => f.name === 'woff2_web').description).toMatch(/fingerprinted/);
	});

	it('every field is a file type', () => {
		expect(createFontFileFields().fields.every(f => f.type === 'file')).toBe(true);
	});

	it('attaches the group and input component when given', () => {
		const Input = () => null;
		const field = createFontFileFields({ group: 'files', input: Input });
		expect(field.group).toBe('files');
		expect(field.components).toEqual({ input: Input });
	});

	it('leaves group and components off when not given', () => {
		const field = createFontFileFields();
		expect(field.group).toBeUndefined();
		expect(field.components).toBeUndefined();
	});

	it('honours a narrowed format list while keeping canonical order', () => {
		const names = namesOf(createFontFileFields({ formats: ['woff2', 'ttf'], derived: false }));
		expect(names).toEqual(['ttf', 'woff2']);
	});

	it('allows the description to be replaced or dropped', () => {
		expect(createFontFileFields({ description: 'Custom' }).description).toBe('Custom');
		expect(createFontFileFields({ description: null }).description).toBeUndefined();
	});

	it('exposes the full format list for callers validating an override', () => {
		expect(FONT_FILE_FORMATS).toContain('woff2_web');
		expect(FONT_FILE_FORMATS).toHaveLength(9);
	});
});
