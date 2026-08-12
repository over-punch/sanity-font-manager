// Tests for the filename-derived retitle path used by the "Preserve file names" switch
import { describe, it, expect } from 'vitest';
import {
	titleFromFileName,
	retitleFontEntryFromFileName,
	retitleAllFonts,
} from '../utils/retitleFontEntries';

/** Minimal entry with the fields the retitle path touches */
function entry(overrides = {}) {
	return {
		tempId: 't1',
		sourceFileName: 'Omnes-VF-Bold.woff2',
		title: 'Omnes Bold VF',
		documentId: 'omnes-bold-vf',
		originalFilename: null,
		style: 'Regular',
		variableFont: false,
		subfamily: 'Regular',
		weightName: 'Bold',
		parsedMetadata: { fullName: 'Omnes Bold', familyName: 'Omnes', italicAngle: 0 },
		decisions: {
			title: { source: 'fontkit-fullName', processed: 'Omnes Bold VF', userOverride: null },
			documentId: { generated: 'omnes-bold-vf', userOverride: null },
			weightName: { detected: 'Bold', userOverride: null },
			subfamily: { detected: 'Regular', userOverride: null },
		},
		...overrides,
	};
}

describe('titleFromFileName', () => {
	it('strips the extension and normalises separators', () => {
		expect(titleFromFileName('Omnes-VF-Bold.woff2')).toBe('Omnes VF Bold');
	});

	it('splits camelCase boundaries', () => {
		expect(titleFromFileName('OmnesSemiBold.ttf')).toBe('Omnes Semi Bold');
	});

	it('collapses repeated whitespace', () => {
		expect(titleFromFileName('Omnes--VF   Bold.otf')).toBe('Omnes VF Bold');
	});

	it('tolerates a missing name', () => {
		expect(titleFromFileName(undefined)).toBe('');
	});
});

describe('retitleFontEntryFromFileName', () => {
	it('derives title, document ID and asset name from the source file', () => {
		const result = retitleFontEntryFromFileName(entry());

		expect(result.title).toBe('Omnes VF Bold');
		expect(result.documentId).toBe('omnes-vf-bold');
		expect(result.originalFilename).toBe('Omnes-VF-Bold');
		expect(result.decisions.title.source).toBe('filename');
	});

	it('leaves an entry the curator has already retitled alone', () => {
		const edited = entry({ decisions: { ...entry().decisions, title: { ...entry().decisions.title, userOverride: 'My Title' } } });
		expect(retitleFontEntryFromFileName(edited)).toBe(edited);
	});

	it('returns the same reference when nothing would change', () => {
		const already = entry({
			title: 'Omnes VF Bold',
			documentId: 'omnes-vf-bold',
			originalFilename: 'Omnes-VF-Bold',
		});
		expect(retitleFontEntryFromFileName(already)).toBe(already);
	});

	it('tolerates an entry with no source file name', () => {
		const orphan = entry({ sourceFileName: undefined });
		expect(retitleFontEntryFromFileName(orphan)).toBe(orphan);
	});
});

describe('retitleAllFonts with preserveFileNames', () => {
	it('switches every entry onto its file name', () => {
		const fonts = { t1: entry(), t2: entry({ tempId: 't2', sourceFileName: 'Omnes-VF-Light.woff2' }) };

		const result = retitleAllFonts(fonts, false, 'Omnes', true);

		expect(result.t1.title).toBe('Omnes VF Bold');
		expect(result.t2.title).toBe('Omnes VF Light');
	});

	it('clears the asset naming hint when switched back off', () => {
		const fonts = { t1: entry({ originalFilename: 'Omnes-VF-Bold' }) };

		const result = retitleAllFonts(fonts, false, 'Omnes', false);

		expect(result.t1.originalFilename).toBeNull();
	});

	it('flags entries whose file names collapse to the same document ID', () => {
		const fonts = {
			t1: entry({ tempId: 't1', sourceFileName: 'Omnes-VF.ttf' }),
			t2: entry({ tempId: 't2', sourceFileName: 'Omnes-VF.woff2' }),
		};

		const result = retitleAllFonts(fonts, false, 'Omnes', true);

		expect(result.t1.documentId).toBe(result.t2.documentId);
		expect(result.t1._idConflict).toBe(true);
		expect(result.t2._idConflict).toBe(true);
	});
});
