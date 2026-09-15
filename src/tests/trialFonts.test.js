// Tests for trialFonts — env gating, range normalising, request shaping, stale detection and verification polling
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
	normalizeUnicodeRange,
	getTrialConfig,
	trialFileName,
	isTrialCurrent,
	requestTrialFont,
	collectFontsForTrial,
	verifyTrialFonts,
	generateTrialFonts,
	DEFAULT_TRIAL_LABEL,
} from '../utils/trialFonts.js';

/** TDF's configured range: printable ASCII */
const RANGE = 'U+0020-007E';
/** An enabled config, built without touching the env */
const CONFIG = getTrialConfig({ range: RANGE, label: 'DEMO' });

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
});

describe('normalizeUnicodeRange', () => {
	it('canonicalises separators, case and a missing prefix', () => {
		expect(normalizeUnicodeRange('u+0020, U+002E  0030-0039,U+0041-005a')).toBe('U+0020,U+002E,U+0030-0039,U+0041-005A');
	});

	it('drops invalid tokens instead of discarding the whole range', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(normalizeUnicodeRange('U+0020,latin,U+ZZZZ,U+0041-005A')).toBe('U+0020,U+0041-005A');
	});

	it('returns an empty string for nothing usable', () => {
		expect(normalizeUnicodeRange('')).toBe('');
		expect(normalizeUnicodeRange(undefined)).toBe('');
	});
});

describe('getTrialConfig', () => {
	it('is disabled when the env range is unset', () => {
		expect(getTrialConfig()).toEqual({ enabled: false, unicodeRange: '', label: DEFAULT_TRIAL_LABEL });
	});

	it('reads the range and label from the studio env', () => {
		vi.stubEnv('SANITY_STUDIO_TRIAL_UNICODE_RANGE', 'U+0020, U+0041-005A');
		vi.stubEnv('SANITY_STUDIO_TRIAL_LABEL', 'Trial');
		expect(getTrialConfig()).toEqual({ enabled: true, unicodeRange: 'U+0020,U+0041-005A', label: 'Trial' });
	});

	it('falls back to DEMO when the label could not go into a PostScript name', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(getTrialConfig({ range: RANGE, label: 'Not OK' }).label).toBe('DEMO');
	});

	it('stays disabled when the range holds no valid token', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		expect(getTrialConfig({ range: 'latin' }).enabled).toBe(false);
	});
});

describe('trialFileName', () => {
	it('prefixes the label and hyphenates the title', () => {
		expect(trialFileName('Romek Bold Italic')).toBe('DEMO_Romek-Bold-Italic');
	});

	it('strips characters a file system rejects', () => {
		expect(trialFileName('Romek: Bold/Italic?', 'Trial')).toBe('Trial_Romek-BoldItalic');
	});
});

describe('isTrialCurrent', () => {
	it('requires a file built with the same range and label', () => {
		expect(isTrialCurrent({ trialRef: 'file-a', trialRange: RANGE, trialLabel: 'DEMO' }, CONFIG)).toBe(true);
		expect(isTrialCurrent({ trialRef: 'file-a', trialRange: 'U+0041-005A', trialLabel: 'DEMO' }, CONFIG)).toBe(false);
		expect(isTrialCurrent({ trialRef: 'file-a', trialRange: RANGE, trialLabel: 'Trial' }, CONFIG)).toBe(false);
		expect(isTrialCurrent({ trialRef: null, trialRange: RANGE, trialLabel: 'DEMO' }, CONFIG)).toBe(false);
	});
});

describe('requestTrialFont', () => {
	it('posts the generate-trial contract the fontWorker expects', async () => {
		const font = { _id: 'romek-bold', title: 'Romek Bold', sourceUrl: 'https://cdn.sanity.io/a.otf', sourceFormat: 'otf' };
		await requestTrialFont({ siteUrl: 'https://site.test', font, config: CONFIG });
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe('https://site.test/api/sanity/fontWorker');
		expect(init.mode).toBe('no-cors');
		expect(JSON.parse(init.body)).toEqual({
			code: 'generate-trial',
			srcUrl: 'https://cdn.sanity.io/a.otf',
			sourceFormat: 'otf',
			documentId: 'romek-bold',
			documentTitle: 'Romek Bold',
			unicodes: RANGE,
			label: 'DEMO',
		});
	});

	it('rejects instead of hanging when the worker never responds', async () => {
		fetch.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
			init.signal.addEventListener('abort', () => {
				const err = new Error('aborted');
				err.name = 'AbortError';
				reject(err);
			});
		}));
		const font = { _id: 'a', title: 'a', sourceUrl: 'u', sourceFormat: 'otf' };
		const pending = requestTrialFont({ siteUrl: 'https://site.test', font, config: CONFIG, timeoutMs: 1000 });
		const assertion = expect(pending).rejects.toThrow(/did not respond within/);
		await vi.advanceTimersByTimeAsync(1500);
		await assertion;
	});
});

describe('collectFontsForTrial', () => {
	/** Builds a stored font document as the lookup query projects it */
	const doc = (id, over = {}) => ({ _id: id, title: id, otfUrl: null, ttfUrl: null, trialRef: null, trialRange: null, trialLabel: null, ...over });

	it('prefers the OTF and falls back to the TTF', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([
			doc('a', { otfUrl: 'a.otf', ttfUrl: 'a.ttf' }),
			doc('b', { ttfUrl: 'b.ttf' }),
		]) };
		const out = await collectFontsForTrial({ client, ids: ['a', 'b'], config: CONFIG });
		expect(out).toEqual([
			{ _id: 'a', title: 'a', sourceUrl: 'a.otf', sourceFormat: 'otf', trialRef: null },
			{ _id: 'b', title: 'b', sourceUrl: 'b.ttf', sourceFormat: 'ttf', trialRef: null },
		]);
	});

	it('skips fonts with no desktop source', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([doc('a')]) };
		expect(await collectFontsForTrial({ client, ids: ['a'], config: CONFIG })).toEqual([]);
	});

	it('skips current trials but rebuilds ones made with an older range', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([
			doc('current', { otfUrl: 'u', trialRef: 'file-1', trialRange: RANGE, trialLabel: 'DEMO' }),
			doc('stale', { otfUrl: 'u', trialRef: 'file-2', trialRange: 'U+0041-005A', trialLabel: 'DEMO' }),
		]) };
		const out = await collectFontsForTrial({ client, ids: ['current', 'stale'], config: CONFIG });
		expect(out.map((f) => f._id)).toEqual(['stale']);
		// The previous ref travels with the font so verification can wait for a new one.
		expect(out[0].trialRef).toBe('file-2');
	});

	it('rebuilds current trials when forced', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([
			doc('current', { otfUrl: 'u', trialRef: 'file-1', trialRange: RANGE, trialLabel: 'DEMO' }),
		]) };
		expect((await collectFontsForTrial({ client, ids: ['current'], config: CONFIG, force: true })).map((f) => f._id)).toEqual(['current']);
	});

	it('queries nothing when disabled or given no ids', async () => {
		const client = { fetch: vi.fn() };
		expect(await collectFontsForTrial({ client, ids: [], config: CONFIG })).toEqual([]);
		expect(await collectFontsForTrial({ client, ids: ['a'], config: getTrialConfig({ range: '' }) })).toEqual([]);
		expect(client.fetch).not.toHaveBeenCalled();
	});
});

describe('verifyTrialFonts', () => {
	it('waits for a new asset rather than accepting the trial being replaced', async () => {
		const current = { _id: 'a', trialRef: 'file-old', trialRange: RANGE, trialLabel: 'DEMO' };
		const client = { fetch: vi.fn()
			.mockResolvedValueOnce([current])
			.mockResolvedValueOnce([{ ...current, trialRef: 'file-new' }]) };

		const run = verifyTrialFonts({ client, fonts: [{ _id: 'a', trialRef: 'file-old' }], config: CONFIG, timeoutMs: 20000 });
		await vi.advanceTimersByTimeAsync(9000);
		expect(await run).toEqual({ done: ['a'], pending: [] });
		expect(client.fetch).toHaveBeenCalledTimes(2);
	});

	it('reports fonts still pending at the timeout', async () => {
		const client = { fetch: vi.fn().mockResolvedValue([]) };
		const run = verifyTrialFonts({ client, fonts: [{ _id: 'a', trialRef: null }], config: CONFIG, timeoutMs: 10000 });
		await vi.advanceTimersByTimeAsync(12000);
		expect(await run).toEqual({ done: [], pending: ['a'] });
	});
});

describe('generateTrialFonts', () => {
	it('does nothing when trials are not configured', async () => {
		const summary = await generateTrialFonts({
			client: { fetch: vi.fn() },
			siteUrl: 'https://site.test',
			fonts: [{ _id: 'a', sourceUrl: 'u' }],
			config: getTrialConfig({ range: '' }),
		});
		expect(summary).toMatchObject({ requested: 0, disabled: true });
		expect(fetch).not.toHaveBeenCalled();
	});

	it('skips without a site URL instead of posting to a relative path', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		const summary = await generateTrialFonts({ client: {}, siteUrl: '', fonts: [{ _id: 'a', sourceUrl: 'u' }], config: CONFIG });
		expect(summary.requested).toBe(0);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('throttles requests to the concurrency limit', async () => {
		const fonts = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ _id: id, title: id, sourceUrl: `${id}.otf`, sourceFormat: 'otf' }));
		const events = [];
		const summary = await generateTrialFonts({
			client: {},
			siteUrl: 'https://site.test',
			fonts,
			config: CONFIG,
			concurrency: 2,
			verify: false,
			onProgress: (e) => events.push(e),
		});
		expect(fetch).toHaveBeenCalledTimes(5);
		expect(summary.requested).toBe(5);
		expect(events.filter((e) => e.type === 'trial-requested').map((e) => e.requested)).toEqual([2, 4, 5]);
	});
});
