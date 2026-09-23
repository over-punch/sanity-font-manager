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

import generateFontData from '../utils/generateFontData';
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

	it('throws (skips the font) when the existence re-check fails (#2 safety)', async () => {
		const decision = { recommendation: RECOMMENDATION.CREATE, userChoice: null, lookupFailed: true, exact: null, candidates: [] };
		const { client, created } = makeClient({ recheckThrows: true });

		await expect(
			executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null }),
		).rejects.toThrow(/existence re-check failed/);
		expect(created).toHaveLength(0); // never risked an overwrite
	});

	it('patches instead of replacing when a rename lands on a live document', async () => {
		// Resolution ran against the ORIGINAL id and found nothing, so the plan says "create".
		// The curator then renamed the font onto an id that does hold a document.
		const decision = {
			recommendation: RECOMMENDATION.CREATE,
			userChoice: null,
			lookupFailed: false,
			exact: null,
			candidates: [],
			resolvedForId: 'some-other-id',
		};
		const { client, patches, created } = makeClient({
			recheckDoc: { _id: 'font-x', fileInput: { woff2: { _type: 'file', asset: { _ref: 'live-woff2' } } }, metaData: {}, metrics: {} },
		});

		const res = await executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(created).toHaveLength(0); // the live document survived
		expect(patches).toHaveLength(1);
		expect(patches[0].payload).not.toHaveProperty('price'); // curator fields untouched
		expect(patches[0].payload.fileInput.woff2.asset._ref).toBe('live-woff2');
		expect(res.isNew).toBe(false);
		expect(res.convertedToUpdate).toBe(true);
	});

	it('creates a full new document (with curator fields) when there is genuinely no existing doc', async () => {
		const decision = { recommendation: RECOMMENDATION.CREATE, userChoice: null, lookupFailed: false, exact: null, candidates: [] };
		const { client, patches, created } = makeClient();

		const res = await executeSingleFont({ entry: makeEntry(decision), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(client.fetch).toHaveBeenCalledTimes(1); // every create is verified first
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
		expect(res.convertedToUpdate).toBe(false);
	});
});

describe('WOFF2-derived files on a re-upload', () => {
	/** An existing document holding a WOFF2 plus the web/subset files built from it */
	const existingWithDerived = () => ({
		recommendation: RECOMMENDATION.USE_EXACT,
		userChoice: null,
		exact: {
			_id: 'font-x',
			fileInput: {
				ttf: { _type: 'file', asset: { _ref: 'old-ttf' } },
				woff2: { _type: 'file', asset: { _ref: 'old-woff2' } },
				woff2_web: { _type: 'file', asset: { _ref: 'old-web' } },
				woff2_subset: { _type: 'file', asset: { _ref: 'old-subset' } },
				css_subset: { _type: 'file', asset: { _ref: 'old-css-subset' } },
			},
			metaData: {},
			metrics: {},
		},
		candidates: [],
	});

	/** A single-font entry uploading the given file names */
	const entryWith = (names) => ({ ...makeEntry(existingWithDerived()), files: names.map((name) => ({ name })) });

	it('drops the stale web/subset files when a new WOFF2 lands and the studio rebuilds them', async () => {
		const { client, patches } = makeClient();
		const plan = { settings: { ...PLAN.settings, webAndSubset: true } };

		await executeSingleFont({ entry: entryWith(['x.woff2']), plan, client, progress: makeProgress(), onProgress: null });

		const fileInput = patches[0].payload.fileInput;
		expect(fileInput.woff2.asset._ref).toBe('asset-new-1');
		expect(fileInput).not.toHaveProperty('woff2_web');
		expect(fileInput).not.toHaveProperty('woff2_subset');
		expect(fileInput).not.toHaveProperty('css_subset');
		// Formats not derived from the WOFF2 still carry over.
		expect(fileInput.ttf.asset._ref).toBe('old-ttf');
	});

	it('keeps the web/subset files when the upload has no new WOFF2', async () => {
		const { client, patches } = makeClient();
		const plan = { settings: { ...PLAN.settings, webAndSubset: true } };

		await executeSingleFont({ entry: entryWith(['x.ttf']), plan, client, progress: makeProgress(), onProgress: null });

		const fileInput = patches[0].payload.fileInput;
		expect(fileInput.woff2_web.asset._ref).toBe('old-web');
		expect(fileInput.woff2_subset.asset._ref).toBe('old-subset');
	});

	it('keeps them, with a warning, when the studio does not rebuild web/subset files', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { client, patches } = makeClient();

		await executeSingleFont({ entry: entryWith(['x.woff2']), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(patches[0].payload.fileInput.woff2_subset.asset._ref).toBe('old-subset');
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/out of date/));
		warn.mockRestore();
	});
});

describe('opentypeFeatures on a re-upload', () => {
	/** A decision that routes executeSingleFont down the update path against an existing document */
	const updateDecision = () => ({
		recommendation: RECOMMENDATION.USE_EXACT,
		userChoice: null,
		exact: { _id: 'font-x', fileInput: {}, metaData: {}, metrics: {} },
		candidates: [],
	});

	/** The metadata shape generateFontData resolves with, overridable per test */
	const metadata = (opentypeFeatures) => ({
		metaData: { unitsPerEm: 1000 },
		metrics: { ascent: 800 },
		variableAxes: null,
		variableInstances: null,
		opentypeFeatures,
		characterSet: { chars: [] },
		glyphCount: 42,
		variableFont: false,
	});

	it('refreshes features and the foundry\'s names when the parse produced tags', async () => {
		generateFontData.mockResolvedValueOnce(
			metadata({ chars: ['liga', 'ss01'], featureList: [{ tag: 'ss01', title: 'Alt g' }] }),
		);
		const { client, patches } = makeClient();

		await executeSingleFont({ entry: makeEntry(updateDecision()), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(patches[0].payload.opentypeFeatures).toEqual({
			chars: ['liga', 'ss01'],
			featureList: [{ tag: 'ss01', title: 'Alt g' }],
		});
	});

	it('leaves the document\'s features alone when the parse produced none', async () => {
		// A font that fails to parse still yields `{ chars: [], featureList: [] }`, which is truthy.
		// Refreshing with it would wipe real features and the foundry's stylistic set names.
		generateFontData.mockResolvedValueOnce(metadata({ chars: [], featureList: [] }));
		const { client, patches } = makeClient();

		await executeSingleFont({ entry: makeEntry(updateDecision()), plan: PLAN, client, progress: makeProgress(), onProgress: null });

		expect(patches[0].payload).not.toHaveProperty('opentypeFeatures');
	});
});
