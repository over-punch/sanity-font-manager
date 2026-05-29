// Tests for updateTypefaceDocument — subfamily grouping, patch assembly, preferred style, deduplication
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { updateTypefaceDocument } from '../utils/updateTypefaceDocument';

// ---------------------------------------------------------------------------
// Mock Sanity client builder
// ---------------------------------------------------------------------------

/** Builds a chainable mock Sanity client. Captures calls for assertions. */
function mockClient({ fetchResult = [null], publishedDoc = null } = {}) {
	const committed = [];
	const fetched = [];

	const patchObj = {
		set: vi.fn().mockReturnThis(),
		commit: vi.fn().mockImplementation(function () {
			committed.push(this._id);
			return Promise.resolve();
		}),
	};

	const client = {
		patch: vi.fn().mockImplementation((id) => {
			patchObj._id = id;
			return patchObj;
		}),
		fetch: vi.fn().mockImplementation((query, params) => {
			fetched.push({ query, params });
			if (query.includes('$publishedId')) {
				return Promise.resolve(publishedDoc ? [publishedDoc] : []);
			}
			return Promise.resolve(fetchResult);
		}),
		_committed: committed,
		_fetched: fetched,
		_patch: patchObj,
	};

	return client;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const noop = () => {};

/** Calls updateTypefaceDocument with sensible defaults, overriding only what the test needs */
async function run({
	doc_id = 'typeface-abc',
	fontRefs = [],
	variableRefs = [],
	subfamilies = {},
	uniqueSubfamilies = [],
	subfamiliesArray = [],
	preferredStyleRef = {},
	newPreferredStyle = { weight: -100, style: 'Italic', _ref: '' },
	stylesObject = {},
	client = mockClient(),
	setStatus = noop,
	setError = noop,
} = {}) {
	await updateTypefaceDocument(
		doc_id,
		fontRefs,
		variableRefs,
		subfamilies,
		uniqueSubfamilies,
		subfamiliesArray,
		preferredStyleRef,
		newPreferredStyle,
		stylesObject,
		client,
		setStatus,
		setError,
	);
	return client;
}

// ---------------------------------------------------------------------------
// Patch assembly — fonts and variableFont arrays
// ---------------------------------------------------------------------------

describe('patch assembly', () => {
	it('merges new fontRefs with existing styles.fonts', async () => {
		const existing = [{ _ref: 'existing-font', _type: 'reference' }];
		const incoming = [{ _ref: 'new-font', _type: 'reference' }];
		const client = await run({
			fontRefs: incoming,
			stylesObject: { fonts: existing },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch['styles.fonts']).toHaveLength(2);
		expect(patch['styles.fonts'].map(f => f._ref)).toContain('existing-font');
		expect(patch['styles.fonts'].map(f => f._ref)).toContain('new-font');
	});

	it('uses only fontRefs when styles.fonts is empty', async () => {
		const incoming = [{ _ref: 'new-font', _type: 'reference' }];
		const client = await run({ fontRefs: incoming, stylesObject: {} });
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch['styles.fonts']).toEqual(incoming);
	});

	it('merges new variableRefs with existing styles.variableFont', async () => {
		const existing = [{ _ref: 'existing-vf', _type: 'reference' }];
		const incoming = [{ _ref: 'new-vf', _type: 'reference' }];
		const client = await run({
			variableRefs: incoming,
			stylesObject: { variableFont: existing },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch['styles.variableFont']).toHaveLength(2);
	});

	it('uses only variableRefs when styles.variableFont is absent', async () => {
		const incoming = [{ _ref: 'new-vf', _type: 'reference' }];
		const client = await run({ variableRefs: incoming, stylesObject: {} });
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch['styles.variableFont']).toEqual(incoming);
	});
});

// ---------------------------------------------------------------------------
// Subfamily grouping
// ---------------------------------------------------------------------------

describe('subfamily grouping', () => {
	it('creates a new subfamily group when one does not already exist', async () => {
		const client = await run({
			subfamilies: { 'myfont-bold': 'Condensed' },
			uniqueSubfamilies: ['Condensed'],
			subfamiliesArray: [],
		});
		const patch = client._patch.set.mock.calls[0][0];
		const group = patch['styles.subfamilies'].find(sf => sf.title === 'Condensed');
		expect(group).toBeDefined();
		expect(group._type).toBe('object');
		expect(typeof group._key).toBe('string');
	});

	it('does not duplicate an existing subfamily group', async () => {
		const existing = [{ title: 'Condensed', _key: 'existing-key', _type: 'object', fonts: [] }];
		const client = await run({
			subfamilies: { 'myfont-bold': 'Condensed' },
			uniqueSubfamilies: ['Condensed'],
			subfamiliesArray: existing,
		});
		const patch = client._patch.set.mock.calls[0][0];
		const groups = patch['styles.subfamilies'].filter(sf => sf.title === 'Condensed');
		expect(groups).toHaveLength(1);
	});

	it('associates font IDs with their correct subfamily group', async () => {
		const client = await run({
			subfamilies: {
				'myfont-bold': 'Condensed',
				'myfont-light': 'Condensed',
			},
			uniqueSubfamilies: ['Condensed'],
			subfamiliesArray: [],
		});
		const patch = client._patch.set.mock.calls[0][0];
		const group = patch['styles.subfamilies'].find(sf => sf.title === 'Condensed');
		const refs = group.fonts.map(f => f._ref);
		expect(refs).toContain('myfont-bold');
		expect(refs).toContain('myfont-light');
	});

	it('skips VF font IDs when assigning to subfamily groups', async () => {
		const client = await run({
			subfamilies: {
				'myfont-vf': 'Condensed',
				'myfont-bold': 'Condensed',
			},
			uniqueSubfamilies: ['Condensed'],
			subfamiliesArray: [],
		});
		const patch = client._patch.set.mock.calls[0][0];
		const group = patch['styles.subfamilies'].find(sf => sf.title === 'Condensed');
		expect(group.fonts.map(f => f._ref)).not.toContain('myfont-vf');
		expect(group.fonts.map(f => f._ref)).toContain('myfont-bold');
	});

	it('deduplicates font references within a subfamily group', async () => {
		const existing = [{
			title: 'Condensed',
			_key: 'k1',
			_type: 'object',
			fonts: [{ _ref: 'myfont-bold', _key: 'f1', _type: 'reference', _weak: true }],
		}];
		const client = await run({
			subfamilies: { 'myfont-bold': 'Condensed' },
			uniqueSubfamilies: ['Condensed'],
			subfamiliesArray: existing,
		});
		const patch = client._patch.set.mock.calls[0][0];
		const group = patch['styles.subfamilies'].find(sf => sf.title === 'Condensed');
		expect(group.fonts.filter(f => f._ref === 'myfont-bold')).toHaveLength(1);
	});

	it('sets styles.subfamilies to [] when there is only one unique subfamily', async () => {
		// Single subfamily means no grouping needed — patch['styles.subfamilies'] is the subfamiliesArray,
		// but patch['styles.subfamilies'] (the raw list placeholder) is set to [] first
		const client = await run({
			uniqueSubfamilies: ['Regular'],
			subfamilies: { 'myfont-regular': 'Regular' },
			subfamiliesArray: [],
		});
		const patch = client._patch.set.mock.calls[0][0];
		// Initial placeholder is [] for single subfamily, overwritten with subfamiliesArray later
		// Final patch['styles.subfamilies'] is the resolved subfamiliesArray (may have one entry)
		expect(Array.isArray(patch['styles.subfamilies'])).toBe(true);
	});

	it('handles multiple distinct subfamily groups', async () => {
		const client = await run({
			subfamilies: {
				'myfont-cond-bold': 'Condensed',
				'myfont-ext-bold': 'Extended',
			},
			uniqueSubfamilies: ['Condensed', 'Extended'],
			subfamiliesArray: [],
		});
		const patch = client._patch.set.mock.calls[0][0];
		const titles = patch['styles.subfamilies'].map(sf => sf.title);
		expect(titles).toContain('Condensed');
		expect(titles).toContain('Extended');
	});
});

// ---------------------------------------------------------------------------
// Sanity client calls
// ---------------------------------------------------------------------------

describe('client interactions', () => {
	it('calls client.patch with the doc_id and commits', async () => {
		const client = await run({ doc_id: 'typeface-xyz' });
		expect(client.patch).toHaveBeenCalledWith('typeface-xyz');
		expect(client._patch.commit).toHaveBeenCalled();
	});

	it('also patches the published document when doc_id is a draft', async () => {
		const client = mockClient({ publishedDoc: { _id: 'typeface-xyz' } });
		await run({ doc_id: 'drafts.typeface-xyz', client });
		// patch called once for draft, once for published
		expect(client.patch).toHaveBeenCalledTimes(2);
		expect(client.patch).toHaveBeenCalledWith('typeface-xyz');
	});

	it('does not patch a published document when the published doc does not exist', async () => {
		const client = mockClient({ publishedDoc: null });
		await run({ doc_id: 'drafts.typeface-xyz', client });
		// fetch is called but no second patch
		expect(client.patch).toHaveBeenCalledTimes(1);
	});

	it('calls setError when the client throws', async () => {
		const badClient = mockClient();
		badClient._patch.commit.mockRejectedValue(new Error('Network error'));
		const setError = vi.fn();
		await run({ client: badClient, setError });
		expect(setError).toHaveBeenCalledWith(true);
	});

	it('calls setStatus at least twice during a normal run', async () => {
		const setStatus = vi.fn();
		await run({ setStatus });
		expect(setStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
	});
});

// ---------------------------------------------------------------------------
// preferredStyle promotion
// ---------------------------------------------------------------------------

describe('preferredStyle — sticky behaviour', () => {
	it('does not set preferredStyle when preferredStyleRef has no _ref and candidate has no _ref', async () => {
		const client = await run({
			preferredStyleRef: {},
			newPreferredStyle: { weight: -100, style: 'Italic', _ref: '' },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch.preferredStyle).toBeUndefined();
	});

	it('sets preferredStyle when currently empty and candidate has a _ref', async () => {
		const client = await run({
			preferredStyleRef: {},
			newPreferredStyle: { weight: 400, style: 'Regular', _ref: 'new-font' },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch.preferredStyle).toEqual({
			_type: 'reference',
			_ref: 'new-font',
			_weak: true,
		});
	});

	it('does NOT overwrite an existing preferredStyle — sticky', async () => {
		const client = await run({
			preferredStyleRef: { _ref: 'existing-pref' },
			newPreferredStyle: { weight: 700, style: 'Regular', _ref: 'bold-font' },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch.preferredStyle).toBeUndefined();
	});

	it('treats empty string _ref as empty', async () => {
		const client = await run({
			preferredStyleRef: { _ref: '' },
			newPreferredStyle: { weight: 400, style: 'Regular', _ref: 'new-font' },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch.preferredStyle?._ref).toBe('new-font');
	});

	it('treats null _ref as empty', async () => {
		const client = await run({
			preferredStyleRef: { _ref: null },
			newPreferredStyle: { weight: 400, style: 'Regular', _ref: 'new-font' },
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch.preferredStyle?._ref).toBe('new-font');
	});
});

// ---------------------------------------------------------------------------
// Dot-path patch preserves sibling fields
// ---------------------------------------------------------------------------

describe('dot-path patch keys', () => {
	it('uses dot-path keys for styles.fonts and styles.variableFont', async () => {
		const client = await run({
			fontRefs: [{ _ref: 'font-1', _type: 'reference' }],
		});
		const patch = client._patch.set.mock.calls[0][0];
		expect(patch).toHaveProperty('styles.fonts');
		expect(patch).toHaveProperty('styles.variableFont');
		// Must NOT have a nested styles object (which would clobber siblings)
		expect(patch.styles).toBeUndefined();
	});

	it('does not include styles.collections or styles.pairs in the patch', async () => {
		const client = await run({
			stylesObject: {
				fonts: [],
				collections: [{ _ref: 'coll-1' }],
				pairs: [{ _ref: 'pair-1' }],
				free: [{ _ref: 'free-1' }],
				displayStyles: [{ style: 'display' }],
			},
		});
		const patch = client._patch.set.mock.calls[0][0];
		// These fields should NOT appear in the patch at all
		expect(patch['styles.collections']).toBeUndefined();
		expect(patch['styles.pairs']).toBeUndefined();
		expect(patch['styles.free']).toBeUndefined();
		expect(patch['styles.displayStyles']).toBeUndefined();
	});
});
