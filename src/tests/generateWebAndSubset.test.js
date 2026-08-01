// Tests for generateWebAndSubset — request shaping, throttling, skip logic and verification polling
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
	generateWebAndSubset,
	collectFontsForGeneration,
	requestWebAndSubset,
	verifyWebAndSubset,
} from '../utils/generateWebAndSubset.js';

/** Builds a font shaped as the generator expects */
const font = (id, over = {}) => ({
	_id: id,
	title: id,
	woff2Url: `https://cdn/${id}.woff2`,
	filename: id,
	variableFont: false,
	style: 'Regular',
	weight: 400,
	...over,
});

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('requestWebAndSubset', () => {
	it('posts the generate-subset contract the fontWorker expects', async () => {
		await requestWebAndSubset({ siteUrl: 'https://site.test', font: font('a') });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('https://site.test/api/sanity/fontWorker');
		expect(init.method).toBe('POST');
		// Studio and site are different origins — the response is opaque by design.
		expect(init.mode).toBe('no-cors');
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({
			code: 'generate-subset',
			woff2Url: 'https://cdn/a.woff2',
			documentId: 'a',
			documentTitle: 'a',
		});
	});
});

describe('collectFontsForGeneration', () => {
	it('skips fonts that already have both derived files', async () => {
		const client = {
			fetch: vi.fn().mockResolvedValue([
				{ _id: 'a', woff2Url: 'u', hasWeb: true, hasSubset: true },
				{ _id: 'b', woff2Url: 'u', hasWeb: true, hasSubset: false },
				{ _id: 'c', woff2Url: 'u', hasWeb: false, hasSubset: false },
			]),
		};
		const out = await collectFontsForGeneration({ client, ids: ['a', 'b', 'c'] });
		expect(out.map((f) => f._id)).toEqual(['b', 'c']);
		// The internal flags must not leak into the request payload.
		expect(out[0]).not.toHaveProperty('hasWeb');
	});

	it('skips fonts with no WOFF2 to subset', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([{ _id: 'a', woff2Url: null, hasWeb: false, hasSubset: false }]) };
		expect(await collectFontsForGeneration({ client, ids: ['a'] })).toEqual([]);
	});

	it('re-includes complete fonts when forced', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([{ _id: 'a', woff2Url: 'u', hasWeb: true, hasSubset: true }]) };
		expect((await collectFontsForGeneration({ client, ids: ['a'], force: true })).map((f) => f._id)).toEqual(['a']);
	});

	it('returns nothing for an empty id list without querying', async () => {
		const client = { fetch: vi.fn() };
		expect(await collectFontsForGeneration({ client, ids: [] })).toEqual([]);
		expect(client.fetch).not.toHaveBeenCalled();
	});
});

describe('generateWebAndSubset', () => {
	it('does nothing without a site URL, and says so', async () => {
		const client = { fetch: vi.fn() };
		const out = await generateWebAndSubset({ client, siteUrl: '', fonts: [font('a')] });
		expect(out).toMatchObject({ requested: 0, skipped: 1 });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('requests every usable font', async () => {
		const client = { fetch: vi.fn().mockResolvedValue(['a', 'b']) };
		const p = generateWebAndSubset({ client, siteUrl: 'https://site.test', fonts: [font('a'), font('b')], concurrency: 1 });
		await vi.advanceTimersByTimeAsync(10000);
		const out = await p;
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(out.requested).toBe(2);
	});

	it('survives a failing request without throwing', async () => {
		fetch.mockRejectedValue(new Error('network down'));
		const client = { fetch: vi.fn().mockResolvedValue([]) };
		const p = generateWebAndSubset({ client, siteUrl: 'https://site.test', fonts: [font('a')], timeoutMs: 5000 });
		await vi.advanceTimersByTimeAsync(10000);
		await expect(p).resolves.toMatchObject({ requested: 1 });
	});

	it('reports fonts still pending when verification times out', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([]) };
		const p = generateWebAndSubset({ client, siteUrl: 'https://site.test', fonts: [font('a')], timeoutMs: 8000 });
		await vi.advanceTimersByTimeAsync(20000);
		const out = await p;
		expect(out.pending).toEqual(['a']);
		expect(out.done).toEqual([]);
	});

	it('skips verification when asked', async () => {
		const client = { fetch: vi.fn() };
		const p = generateWebAndSubset({ client, siteUrl: 'https://site.test', fonts: [font('a')], verify: false });
		await vi.advanceTimersByTimeAsync(1000);
		await p;
		expect(client.fetch).not.toHaveBeenCalled();
	});
});

describe('verifyWebAndSubset', () => {
	it('resolves once every id reports both files', async () => {
		const client = { fetch: vi.fn().mockResolvedValue(['a', 'b']) };
		const p = verifyWebAndSubset({ client, ids: ['a', 'b'], timeoutMs: 30000 });
		await vi.advanceTimersByTimeAsync(5000);
		const out = await p;
		expect(out.done.sort()).toEqual(['a', 'b']);
		expect(out.pending).toEqual([]);
	});

	it('keeps polling while only some are done', async () => {
		const client = { fetch: vi.fn().mockResolvedValueOnce(['a']).mockResolvedValue(['b']) };
		const p = verifyWebAndSubset({ client, ids: ['a', 'b'], timeoutMs: 30000 });
		await vi.advanceTimersByTimeAsync(12000);
		const out = await p;
		expect(out.done.sort()).toEqual(['a', 'b']);
	});

	it('treats a failing query as non-fatal and retries', async () => {
		const client = { fetch: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(['a']) };
		const p = verifyWebAndSubset({ client, ids: ['a'], timeoutMs: 30000 });
		await vi.advanceTimersByTimeAsync(12000);
		await expect(p).resolves.toMatchObject({ done: ['a'] });
	});
});
