// Tests for mergeFontEntries — file claiming, metadata source selection, and drop reporting
import { describe, it, expect } from 'vitest';
import { mergeFontEntries, findFileTypeCollisions, fileTypeOf } from '../utils/mergeFontEntries';

/** Builds a minimal font plan entry with the given file names */
function entry(tempId, fileNames, overrides = {}) {
	return {
		tempId,
		documentId: tempId,
		title: tempId,
		files: fileNames.map(name => ({ name })),
		sourceFileName: fileNames[0],
		weight: 400,
		weightName: '',
		style: 'Regular',
		subfamily: '',
		variableFont: false,
		originalFilename: null,
		parsedMetadata: { fullName: `full-${tempId}` },
		glyphCount: 100,
		opentypeFeatures: { chars: ['kern'] },
		variationAxes: null,
		decisions: { title: { userOverride: null } },
		...overrides,
	};
}

describe('fileTypeOf', () => {
	it('returns the lowercased extension for supported formats', () => {
		expect(fileTypeOf({ name: 'Omnes-VF.WOFF2' })).toBe('woff2');
		expect(fileTypeOf({ name: 'Omnes-VF.ttf' })).toBe('ttf');
	});

	it('returns null for formats the executor cannot upload', () => {
		expect(fileTypeOf({ name: 'Omnes-VF.zip' })).toBeNull();
		expect(fileTypeOf({ name: 'Omnes-VF.css' })).toBeNull();
		expect(fileTypeOf({})).toBeNull();
	});
});

describe('findFileTypeCollisions', () => {
	it('reports only types supplied by more than one entry', () => {
		const collisions = findFileTypeCollisions([
			entry('a', ['Omnes-VF.ttf', 'Omnes-VF.woff2']),
			entry('b', ['Omnes-VF.woff2']),
		]);
		expect(Object.keys(collisions)).toEqual(['woff2']);
		expect(collisions.woff2).toHaveLength(2);
	});

	it('does not treat a repeated type within one entry as a collision', () => {
		const collisions = findFileTypeCollisions([entry('a', ['One.woff2', 'Two.woff2'])]);
		expect(collisions).toEqual({});
	});
});

describe('mergeFontEntries', () => {
	it('combines complementary file sets and keeps the primary reviewed values', () => {
		const a = entry('a', ['Omnes-VF.ttf'], { title: 'Omnes VF', documentId: 'omnes-vf', weight: 700 });
		const b = entry('b', ['Omnes-VF.woff2'], { title: 'Omnes Variable VF', documentId: 'omnes-variable-vf' });

		const { merged, report } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged.tempId).toBe('a');
		expect(merged.title).toBe('Omnes VF');
		expect(merged.documentId).toBe('omnes-vf');
		expect(merged.weight).toBe(700);
		expect(merged.files.map(f => f.name)).toEqual(['Omnes-VF.ttf', 'Omnes-VF.woff2']);
		expect(report.mergedTempIds).toEqual(['b']);
		expect(report.dropped).toEqual([]);
	});

	it('orders files canonically so the outline is uploaded first', () => {
		const a = entry('a', ['Omnes.woff2']);
		const b = entry('b', ['Omnes.otf', 'Omnes.eot']);

		const { merged } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged.files.map(f => f.name)).toEqual(['Omnes.otf', 'Omnes.woff2', 'Omnes.eot']);
	});

	it('drops a duplicate format and says which file lost', () => {
		const a = entry('a', ['A.woff2']);
		const b = entry('b', ['B.woff2']);

		const { merged, report } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged.files.map(f => f.name)).toEqual(['A.woff2']);
		expect(report.dropped).toEqual([
			{ fileName: 'B.woff2', type: 'woff2', fromTempId: 'b', reason: 'duplicate-format' },
		]);
	});

	it('honours an explicit file source over the primary', () => {
		const a = entry('a', ['A.woff2']);
		const b = entry('b', ['B.woff2']);

		const { merged, report } = mergeFontEntries([a, b], {
			primaryTempId: 'a',
			fileSources: { woff2: 'b' },
		});

		expect(merged.files.map(f => f.name)).toEqual(['B.woff2']);
		expect(report.dropped).toEqual([
			{ fileName: 'A.woff2', type: 'woff2', fromTempId: 'a', reason: 'superseded' },
		]);
	});

	it('takes binary-derived fields from the entry supplying the surviving outline', () => {
		const webfont = entry('web', ['Omnes.woff2'], {
			parsedMetadata: { fullName: 'thin name table' },
			glyphCount: 12,
			variationAxes: null,
			opentypeFeatures: { chars: [] },
		});
		const outline = entry('ttf', ['Omnes.ttf'], {
			parsedMetadata: { fullName: 'Omnes Variable' },
			glyphCount: 843,
			variationAxes: { wght: { min: 100, max: 900 } },
			opentypeFeatures: { chars: ['kern', 'liga', 'ss01'] },
		});

		const { merged, report } = mergeFontEntries([webfont, outline], { primaryTempId: 'web' });

		expect(merged.parsedMetadata.fullName).toBe('Omnes Variable');
		expect(merged.glyphCount).toBe(843);
		expect(merged.variationAxes).toEqual({ wght: { min: 100, max: 900 } });
		expect(merged.opentypeFeatures.chars).toContain('ss01');
		expect(report.metadataFromTempId).toBe('ttf');
		expect(report.hasOutlineSource).toBe(true);
	});

	it('keeps the primary metadata when the primary supplies the outline', () => {
		const outline = entry('a', ['Omnes.ttf'], { glyphCount: 843 });
		const webfont = entry('b', ['Omnes.woff2'], { glyphCount: 12 });

		const { merged, report } = mergeFontEntries([outline, webfont], { primaryTempId: 'a' });

		expect(merged.glyphCount).toBe(843);
		expect(report.metadataFromTempId).toBe('a');
	});

	it('reports when no outline survives the merge', () => {
		const a = entry('a', ['Omnes.woff2']);
		const b = entry('b', ['Omnes.woff']);

		const { report } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(report.hasOutlineSource).toBe(false);
		expect(report.metadataFromTempId).toBe('a');
	});

	it('adopts the outline variableFont flag and flags the change', () => {
		const webfont = entry('web', ['Omnes.woff2'], { variableFont: false });
		const outline = entry('ttf', ['Omnes.ttf'], { variableFont: true });

		const { merged, report } = mergeFontEntries([webfont, outline], { primaryTempId: 'web' });

		expect(merged.variableFont).toBe(true);
		expect(report.variableFontChanged).toBe(true);
	});

	it('drops files the executor cannot upload', () => {
		const a = entry('a', ['Omnes.ttf', 'Omnes.zip']);
		const b = entry('b', ['Omnes.woff2']);

		const { merged, report } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged.files.map(f => f.name)).toEqual(['Omnes.ttf', 'Omnes.woff2']);
		expect(report.dropped).toEqual([
			{ fileName: 'Omnes.zip', type: null, fromTempId: 'a', reason: 'unsupported-format' },
		]);
	});

	it('inherits an originalFilename from a secondary entry when the primary has none', () => {
		const a = entry('a', ['Omnes.ttf'], { originalFilename: null });
		const b = entry('b', ['Omnes.woff2'], { originalFilename: 'Omnes-VF' });

		const { merged } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged.originalFilename).toBe('Omnes-VF');
	});

	it('clears any stale conflict flag on the merged entry', () => {
		const a = entry('a', ['Omnes.ttf'], { _idConflict: true });
		const b = entry('b', ['Omnes.woff2'], { _idConflict: true });

		const { merged } = mergeFontEntries([a, b], { primaryTempId: 'a' });

		expect(merged._idConflict).toBe(false);
	});

	it('falls back to the first entry when the primary id is unknown', () => {
		const a = entry('a', ['Omnes.ttf']);
		const b = entry('b', ['Omnes.woff2']);

		const { merged } = mergeFontEntries([a, b], { primaryTempId: 'nope' });

		expect(merged.tempId).toBe('a');
	});

	it('returns a single entry unchanged', () => {
		const a = entry('a', ['Omnes.ttf']);
		const { merged, report } = mergeFontEntries([a]);
		expect(merged).toBe(a);
		expect(report.mergedTempIds).toEqual([]);
	});

	it('throws when given nothing to merge', () => {
		expect(() => mergeFontEntries([])).toThrow(/at least one entry/);
	});
});
