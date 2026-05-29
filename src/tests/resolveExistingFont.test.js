// Tests for resolveExistingFont — document resolution with ID, slug, and content matching
import { describe, it, expect, vi } from 'vitest';
import { resolveExistingFont } from '../utils/uploadFontFiles';

// ---------------------------------------------------------------------------
// Mock Sanity client builder
// ---------------------------------------------------------------------------

/** Builds a mock client that returns different results for ID vs. content queries */
function mockClient({ idResults = [], contentResults = [] } = {}) {
	return {
		fetch: vi.fn().mockImplementation((query) => {
			if (query.includes('slug.current')) {
				return Promise.resolve(idResults);
			}
			if (query.includes('lower(typefaceName)')) {
				return Promise.resolve(contentResults);
			}
			return Promise.resolve([]);
		}),
	};
}

/** Builds a minimal font object for resolution */
function mockFont(overrides = {}) {
	return {
		_id: 'myfont-bold',
		title: 'MyFont Bold',
		typefaceName: 'MyFont',
		weightName: 'Bold',
		style: 'Regular',
		subfamily: '',
		variableFont: false,
		...overrides,
	};
}

/** Builds a minimal existing doc */
function mockExistingDoc(overrides = {}) {
	return {
		_id: 'myfont-bold',
		title: 'MyFont Bold',
		weight: 700,
		style: 'Regular',
		weightName: 'Bold',
		typefaceName: 'MyFont',
		subfamily: '',
		variableFont: false,
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveExistingFont', () => {
	it('returns use-exact when an ID match is found', async () => {
		const client = mockClient({ idResults: [mockExistingDoc()] });
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('use-exact');
		expect(result.exact).toBeTruthy();
		expect(result.exact._id).toBe('myfont-bold');
	});

	it('returns use-exact when a slug match is found', async () => {
		const client = mockClient({
			idResults: [mockExistingDoc({ _id: 'legacy-id-123' })],
		});
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('use-exact');
		expect(result.exact._id).toBe('legacy-id-123');
	});

	it('returns use-candidate when one content match is found', async () => {
		const client = mockClient({
			idResults: [],
			contentResults: [mockExistingDoc({ _id: 'old-myfont-bold' })],
		});
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('use-candidate');
		expect(result.candidates).toHaveLength(1);
		expect(result.candidates[0]._id).toBe('old-myfont-bold');
	});

	it('returns ambiguous when multiple content matches are found', async () => {
		const client = mockClient({
			idResults: [],
			contentResults: [
				mockExistingDoc({ _id: 'match-1' }),
				mockExistingDoc({ _id: 'match-2' }),
			],
		});
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('ambiguous');
		expect(result.candidates).toHaveLength(2);
	});

	it('returns create when nothing matches', async () => {
		const client = mockClient({ idResults: [], contentResults: [] });
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('create');
		expect(result.exact).toBeNull();
		expect(result.candidates).toHaveLength(0);
	});

	it('skips content match when ID match already found', async () => {
		const client = mockClient({
			idResults: [mockExistingDoc()],
			contentResults: [mockExistingDoc({ _id: 'content-match' })],
		});
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('use-exact');
		// Content query should not have been called since ID match was found
		expect(client.fetch).toHaveBeenCalledTimes(1);
	});

	it('gracefully falls back to create on network error', async () => {
		const client = {
			fetch: vi.fn().mockRejectedValue(new Error('Network error')),
		};
		const result = await resolveExistingFont(mockFont(), client);
		expect(result.recommendation).toBe('create');
	});

	it('treats empty subfamily and "regular" as equivalent', async () => {
		// The font has empty subfamily, the existing doc has "Regular" — should match
		const client = mockClient({
			idResults: [],
			contentResults: [mockExistingDoc({ subfamily: 'Regular' })],
		});
		const result = await resolveExistingFont(mockFont({ subfamily: '' }), client);
		expect(result.recommendation).toBe('use-candidate');
	});

	it('treats undefined variableFont as false', async () => {
		const client = mockClient({
			idResults: [],
			contentResults: [mockExistingDoc({ variableFont: undefined })],
		});
		const result = await resolveExistingFont(mockFont({ variableFont: false }), client);
		// The query handles !defined(variableFont) && $variableFont == false
		expect(result.recommendation).toBe('use-candidate');
	});

	it('passes parameterized queries (no GROQ injection)', async () => {
		const client = mockClient({ idResults: [] });
		await resolveExistingFont(mockFont({ _id: "test'; drop" }), client);
		// Verify the fetch was called with params object, not string interpolation
		const fetchCall = client.fetch.mock.calls[0];
		expect(fetchCall[1]).toHaveProperty('id', "test'; drop");
	});
});
