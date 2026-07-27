// Tests for executeSingleFont — the create-vs-update decision, the no-clobber partial patch (#1),
// and the lookupFailed existence-recheck guard (#2). Network-bound helpers are mocked so the test
// exercises only the branching / mutation logic.
import { describe, it, expect, vi, beforeEach } from 'vitest';

// generateFontData / generateCssFile parse real font binaries over the network — stub them out.
vi.mock('../utils/generateFontData', () => ({
	default: vi.fn(async () => ({
		metaData: { unitsPerEm: 1000 },
		metrics: { ascent: 800 },
		variableAxes: null,
		variableInstances: null,
		opentypeFeatures: { chars: [] },
		characterSet: { chars: [] },
		glyphCount: 42,
		variableFont: false,
	})),
}));
vi.mock('../utils/generateCssFile', () => ({ default: vi.fn(async () => ({})) }));

import { executeSingleFont } from '../utils/executeUploadPlan';
import { RECOMMENDATION } from '../utils/planTypes';

/** Builds a mock Sanity client capturing patch payloads and createOrReplace docs. */
function makeClient({ recheckDoc = null, recheckThrows = false } = {}) {
	const patches = [];
	const created = [];
	const client = {
		assets: { upload: vi.fn(async () => ({ _id: 'asset-new-1', originalFilename: 'x.ttf' })) },
		patch: vi.fn(id => ({
			set: payload => {
				patches.push({ id, payload });
				return { commit: vi.fn(async () => ({})) };
			},
		})),
		createOrReplace: vi.fn(async doc => {
			created.push(doc);
			return doc;
		}),
		fetch: vi.fn(async () => {
			if (recheckThrows) throw new Error('network down');
			return recheckDoc;
		}),
	};
	return { client, patches, created };
}

/** Builds a single-font entry with a .ttf file and the given existing-document decision. */
function makeEntry(decision) {
	return {
		tempId: 't1',
		documentId: 'font-x',
		title: 'MyFont Bold',
		style: 'Regular',
		weightName: 'Bold',
		subfamily: 'Regular',
		weight: 700,
		variableFont: false,
		originalFilename: null,
		files: [{ name: 'x.ttf' }],
		decisions: { existingDocument: decision },
	};
}

/** Fresh per-font progress record matching what executeUploadPlan seeds. */
function makeProgress() {
	return { t1: { status: 'queued', currentFile: null, filesComplete: 0, filesTotal: 1, assetRefs: {}, error: null } };
}

const PLAN = { settings: { price: 199, typefaceTitle: 'MyFont', preserveFileNames: false } };

beforeEach(() => {
	vi.clearAllMocks();
});

describe('executeSingleFont', () => {
	it('updates with a PARTIAL patch that never touches curator-owned fields (#1 no clobber)', async () => {
		const decision = {
			recommendation: RECOMMENDATION.USE_EXACT,
			userChoice: null,
			exact: { _id: 'font-x', fileInput: { woff2: { _type: 'file', asset: { _ref: 'old-woff2' } } }, metaData: {}, metrics: {} },
			candidates: [],
		};
		const { client, patches, created } = makeClient();

		const res = await executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(created).toHaveLength(0); // never destructively replaced an existing doc
		expect(patches).toHaveLength(1);
		expect(patches[0].id).toBe('font-x');
		const p = patches[0].payload;
		// Curator-owned fields must be absent so .set() leaves them untouched.
		for (const field of ['price', 'sell', 'slug', 'title', 'typefaceName', 'description', 'normalWeight']) {
			expect(p).not.toHaveProperty(field);
		}
		// Binary-derived fields ARE refreshed.
		expect(p.weight).toBe(700);
		expect(p.fileInput.ttf.asset._ref).toBe('asset-new-1');
		// Pre-existing formats not part of this re-upload are preserved.
		expect(p.fileInput.woff2.asset._ref).toBe('old-woff2');
		expect(res.isNew).toBe(false);
	});

	it('re-checks existence and patches (not replaces) when resolution failed but the doc exists (#2)', async () => {
		const decision = { recommendation: RECOMMENDATION.CREATE, userChoice: null, lookupFailed: true, exact: null, candidates: [] };
		const { client, patches, created } = makeClient({ recheckDoc: { _id: 'font-x', fileInput: {}, metaData: {}, metrics: {} } });

		const res = await executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(client.fetch).toHaveBeenCalledTimes(1); // the safety re-check ran
		expect(created).toHaveLength(0); // did NOT clobber the existing document
		expect(patches).toHaveLength(1);
		expect(patches[0].id).toBe('font-x');
		expect(res.isNew).toBe(false);
	});

	it('throws (skips the font) when resolution failed AND the existence re-check also fails (#2 safety)', async () => {
		const decision = { recommendation: RECOMMENDATION.CREATE, userChoice: null, lookupFailed: true, exact: null, candidates: [] };
		const { client, created } = makeClient({ recheckThrows: true });

		await expect(
			executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null }),
		).rejects.toThrow(/re-check also failed/);
		expect(created).toHaveLength(0); // never risked an overwrite
	});

	it('creates a full new document (with curator fields) when there is genuinely no existing doc', async () => {
		const decision = { recommendation: RECOMMENDATION.CREATE, userChoice: null, lookupFailed: false, exact: null, candidates: [] };
		const { client, patches, created } = makeClient();

		const res = await executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(client.fetch).not.toHaveBeenCalled(); // no lookupFailed → no re-check
		expect(patches).toHaveLength(0);
		expect(created).toHaveLength(1);
		expect(created[0]).toMatchObject({
			_id: 'font-x',
			_type: 'font',
			title: 'MyFont Bold',
			slug: { _type: 'slug', current: 'font-x' },
			typefaceName: 'MyFont',
			price: 199,
			sell: true,
			normalWeight: true,
		});
		expect(res.isNew).toBe(true);
	});
});
