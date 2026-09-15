// Env-gated trial (DEMO) fonts — asks the site's fontWorker to subset and rename each font's desktop file, then verifies it landed
import { withTimeout } from './planTypes';

/** Fonts requested at once. Each one is a server-side fontTools subset, so bursts are throttled. */
const DEFAULT_CONCURRENCY = 4;
/** How long to wait for the worker to finish writing before giving up, in ms. */
const DEFAULT_TIMEOUT_MS = 180000;
/** Gap between verification polls, in ms. */
const POLL_INTERVAL_MS = 4000;
/**
 * How long a single fontWorker request may stay open before it is aborted, in ms. The first trial
 * on a cold function also pays for starting Pyodide, so this is longer than the web/subset request.
 */
const REQUEST_TIMEOUT_MS = 90000;

/** Label appended to trial family names ("Romek DEMO") and prefixed to file names ("DEMO_Romek") */
export const DEFAULT_TRIAL_LABEL = 'DEMO';

/** One Unicode range token after normalising: `U+XXXX` or `U+XXXX-YYYY`, upper-case hex */
const UNICODE_TOKEN_PATTERN = /^U\+[0-9A-F]{1,6}(?:-[0-9A-F]{1,6})?$/;
/** A usable trial label: letters and digits only, 1-16 characters, since it goes into a PostScript name */
const TRIAL_LABEL_PATTERN = /^[A-Za-z0-9]{1,16}$/;

/**
 * Reads an env value without throwing where `process` is not defined.
 * @param {function} read - returns the value; written as a literal `process.env.X` so the Studio build can inline it
 * @returns {string|undefined}
 */
function readEnv(read) {
	try {
		return read();
	} catch {
		return undefined;
	}
}

/**
 * Normalises a Unicode range to the canonical form the fontWorker accepts and stores:
 * comma-separated `U+XXXX` / `U+XXXX-YYYY` tokens, upper-case, no spaces.
 *
 * Accepts commas or whitespace as separators and a missing or lower-case `u+`. Invalid tokens are
 * dropped with a warning rather than failing the whole range.
 *
 * @param {string} value - e.g. "U+0020, u+0030-0039 0041-005A"
 * @returns {string} e.g. "U+0020,U+0030-0039,U+0041-005A", or '' when nothing valid remains
 */
export function normalizeUnicodeRange(value) {
	if (typeof value !== 'string') return '';
	return value
		.split(/[\s,]+/)
		.map((token) => token.trim().toUpperCase())
		.filter(Boolean)
		.map((token) => (token.startsWith('U+') ? token : `U+${token}`))
		.filter((token) => {
			const valid = UNICODE_TOKEN_PATTERN.test(token);
			if (!valid) console.warn(`Trial fonts: ignoring invalid Unicode range token "${token}"`);
			return valid;
		})
		.join(',');
}

/**
 * Resolves the studio's trial font configuration.
 *
 * Trial fonts are switched on purely by `SANITY_STUDIO_TRIAL_UNICODE_RANGE`: when it is unset or
 * holds nothing valid, no trial field is added to the schema and nothing tries to build one.
 * `SANITY_STUDIO_TRIAL_LABEL` optionally replaces the DEMO label.
 *
 * @param {object} [overrides] - `range` / `label` to use instead of the env, mainly for tests
 * @returns {{ enabled: boolean, unicodeRange: string, label: string }}
 */
export function getTrialConfig(overrides = {}) {
	const rawRange = 'range' in overrides
		? overrides.range
		: readEnv(() => process.env.SANITY_STUDIO_TRIAL_UNICODE_RANGE);
	const rawLabel = 'label' in overrides
		? overrides.label
		: readEnv(() => process.env.SANITY_STUDIO_TRIAL_LABEL);

	const unicodeRange = normalizeUnicodeRange(rawRange || '');

	let label = DEFAULT_TRIAL_LABEL;
	const trimmedLabel = typeof rawLabel === 'string' ? rawLabel.trim() : '';
	if (trimmedLabel) {
		if (TRIAL_LABEL_PATTERN.test(trimmedLabel)) label = trimmedLabel;
		else console.warn(`Trial fonts: ignoring invalid label "${trimmedLabel}", using ${DEFAULT_TRIAL_LABEL}`);
	}

	return { enabled: unicodeRange.length > 0, unicodeRange, label };
}

/**
 * Builds the trial download file name, without extension: "Romek Bold" -> "DEMO_Romek-Bold".
 * Mirrors the consuming site's worker so a manual upload is named the same way.
 * @param {string} title - font document title
 * @param {string} [label]
 * @returns {string}
 */
export function trialFileName(title, label = DEFAULT_TRIAL_LABEL) {
	const base = String(title || 'font')
		.trim()
		.replace(/[\\/:*?"<>|]+/g, '')
		.replace(/\s+/g, '-');
	return `${label}_${base || 'font'}`;
}

/**
 * Whether a font's stored trial was built with the current range and label.
 * @param {object} doc - { trialRef, trialRange, trialLabel }
 * @param {object} config - from getTrialConfig
 * @returns {boolean}
 */
export function isTrialCurrent(doc, config) {
	return Boolean(doc?.trialRef) && doc.trialRange === config.unicodeRange && doc.trialLabel === config.label;
}

/**
 * Asks the consuming site's fontWorker to build the trial for one font.
 *
 * Cross-origin `no-cors` POST, so the response is opaque — success is established by polling Sanity
 * in `verifyTrialFonts`, never by this resolving. The worker writes `fileInput.trial` itself.
 *
 * @param {object} params
 * @param {string} params.siteUrl - base URL of the consuming site
 * @param {object} params.font - { _id, title, sourceUrl, sourceFormat }
 * @param {object} params.config - from getTrialConfig
 * @param {number} [params.timeoutMs] - abort the request after this long
 * @returns {Promise<void>} rejects on network failure or timeout; callers warn and continue
 */
export async function requestTrialFont({ siteUrl, font, config, timeoutMs = REQUEST_TIMEOUT_MS }) {
	// Aborting is safe for the same reason as the web/subset request: it does not cancel the
	// server-side build, and the verification poll still picks up whatever lands.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		await fetch(`${siteUrl}/api/sanity/fontWorker`, {
			method: 'POST',
			mode: 'no-cors',
			signal: controller.signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: 'generate-trial',
				srcUrl: font.sourceUrl,
				sourceFormat: font.sourceFormat,
				documentId: font._id,
				documentTitle: font.title,
				unicodes: config.unicodeRange,
				label: config.label,
			}),
		});
	} catch (err) {
		if (err?.name === 'AbortError') {
			throw new Error(`fontWorker did not respond within ${Math.round(timeoutMs / 1000)}s`);
		}
		throw err;
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Reads back font documents and shapes the ones that need a trial for `generateTrialFonts`.
 *
 * The source is the OTF when there is one, otherwise the TTF; fonts with neither are left out.
 * A font whose trial was built with the current range and label is also left out unless forced —
 * so changing the env range makes every existing trial stale and eligible again.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string[]} params.ids - font document ids
 * @param {object} [params.config] - from getTrialConfig
 * @param {boolean} [params.force] - include fonts whose trial is already current
 * @returns {Promise<object[]>} [{ _id, title, sourceUrl, sourceFormat, trialRef }]
 */
export async function collectFontsForTrial({ client, ids = [], config = getTrialConfig(), force = false }) {
	if (!ids.length || !config.enabled) return [];
	const started = Date.now();
	const docs = await withTimeout(client.fetch(
		`*[_type == "font" && _id in $ids]{
			_id, title,
			"otfUrl": fileInput.otf.asset->url,
			"ttfUrl": fileInput.ttf.asset->url,
			"trialRef": fileInput.trial.asset._ref,
			"trialRange": fileInput.trial.unicodeRange,
			"trialLabel": fileInput.trial.label
		}`,
		{ ids }
	), REQUEST_TIMEOUT_MS, 'Trial font lookup');

	const fonts = docs
		.filter((doc) => (doc.otfUrl || doc.ttfUrl) && (force || !isTrialCurrent(doc, config)))
		.map((doc) => ({
			_id: doc._id,
			title: doc.title,
			sourceUrl: doc.otfUrl || doc.ttfUrl,
			sourceFormat: doc.otfUrl ? 'otf' : 'ttf',
			trialRef: doc.trialRef || null,
		}));

	console.log(`Trial fonts: read ${docs.length} of ${ids.length} font documents in ${Date.now() - started}ms, ${fonts.length} need generating`);
	return fonts;
}

/**
 * Keeps only the fonts whose trial source was part of an upload, so a batch rebuilds exactly the
 * trials its files affect. The source is the OTF when the font has one, otherwise the TTF: an uploaded
 * OTF rebuilds, an uploaded TTF rebuilds only a font with no OTF, and web formats never do.
 *
 * @param {object[]} fonts - from collectFontsForTrial, each carrying `sourceFormat`
 * @param {Map<string, Set<string>>} uploadedFormats - font document id -> formats uploaded in the run
 * @returns {object[]}
 */
export function selectFontsWithNewSource(fonts, uploadedFormats) {
	return fonts.filter((font) => Boolean(uploadedFormats.get(font._id)?.has(font.sourceFormat)));
}

/**
 * Polls Sanity until every font carries a new trial built with the current config, or the timeout expires.
 *
 * "New" means the asset ref differs from the one the font had when it was requested, so a forced
 * rebuild is not confirmed by the trial it is replacing.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {object[]} params.fonts - [{ _id, trialRef }] as requested
 * @param {object} params.config - from getTrialConfig
 * @param {number} [params.timeoutMs]
 * @param {function} [params.onProgress] - called with { done, total }
 * @returns {Promise<{done: string[], pending: string[]}>}
 */
export async function verifyTrialFonts({ client, fonts, config, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress }) {
	const started = Date.now();
	const deadline = started + timeoutMs;
	const previousRef = new Map(fonts.map((f) => [f._id, f.trialRef || null]));
	let done = [];
	let pending = fonts.map((f) => f._id);
	let polls = 0;

	while (pending.length && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		polls++;
		let docs = [];
		try {
			docs = await client.fetch(
				`*[_type == "font" && _id in $ids]{
					_id,
					"trialRef": fileInput.trial.asset._ref,
					"trialRange": fileInput.trial.unicodeRange,
					"trialLabel": fileInput.trial.label
				}`,
				{ ids: pending }
			);
		} catch (err) {
			console.warn('Trial font verification query failed:', err.message);
			continue;
		}

		const finished = docs
			.filter((doc) => isTrialCurrent(doc, config) && doc.trialRef !== previousRef.get(doc._id))
			.map((doc) => doc._id);

		if (finished.length) {
			const finishedSet = new Set(finished);
			done = [...done, ...finished];
			pending = pending.filter((id) => !finishedSet.has(id));
			console.log(`Trial fonts: poll ${polls} — ${done.length}/${fonts.length} confirmed (${Date.now() - started}ms elapsed)`);
			if (onProgress) onProgress({ done: done.length, total: fonts.length });
		} else if (polls % 5 === 0) {
			console.log(`Trial fonts: poll ${polls} — still ${pending.length} pending (${Date.now() - started}ms elapsed)`);
		}
	}

	console.log(`Trial fonts: verification finished after ${polls} polls in ${Date.now() - started}ms — ${done.length} confirmed, ${pending.length} pending`);
	return { done, pending };
}

/**
 * Generates trial fonts for a batch of fonts, throttled, then reports what landed.
 *
 * Never throws: a font that uploaded cleanly is not a failed upload because its trial could not be
 * built. Does nothing when trials are not configured. Requires the consuming site's fontWorker to
 * handle `code: 'generate-trial'`.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string} params.siteUrl - base URL of the consuming site
 * @param {object[]} params.fonts - from collectFontsForTrial
 * @param {object} [params.config] - from getTrialConfig
 * @param {number} [params.concurrency]
 * @param {number} [params.timeoutMs]
 * @param {boolean} [params.verify] - poll Sanity to confirm the files landed (default true)
 * @param {function} [params.onProgress] - called with { type, ... }
 * @returns {Promise<{requested: number, skipped: number, done: string[], pending: string[], disabled?: boolean}>}
 */
export async function generateTrialFonts({
	client,
	siteUrl,
	fonts = [],
	config = getTrialConfig(),
	concurrency = DEFAULT_CONCURRENCY,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	verify = true,
	onProgress,
}) {
	if (!config.enabled) {
		return { requested: 0, skipped: fonts.length, done: [], pending: [], disabled: true };
	}

	const usable = fonts.filter((f) => f?._id && f?.sourceUrl);
	const skipped = fonts.length - usable.length;

	if (!siteUrl) {
		console.warn('Trial font generation skipped: no site URL configured');
		return { requested: 0, skipped: fonts.length, done: [], pending: [] };
	}
	if (!usable.length) return { requested: 0, skipped, done: [], pending: [] };

	if (onProgress) onProgress({ type: 'trial-start', total: usable.length, skipped });

	const chunkCount = Math.ceil(usable.length / concurrency);
	const fanOutStart = Date.now();
	console.log(`Trial fonts: requesting ${usable.length} fonts in ${chunkCount} chunks of ${concurrency} from ${siteUrl} (${config.label}, ${config.unicodeRange})`);

	for (let i = 0; i < usable.length; i += concurrency) {
		const chunk = usable.slice(i, i + concurrency);
		await Promise.all(
			chunk.map((font) =>
				requestTrialFont({ siteUrl, font, config }).catch((err) => {
					console.warn(`Trial font request failed for ${font.title}:`, err.message);
				})
			)
		);
		if (onProgress) onProgress({ type: 'trial-requested', requested: Math.min(i + concurrency, usable.length), total: usable.length });
	}

	console.log(`Trial fonts: all ${usable.length} requests sent in ${Date.now() - fanOutStart}ms`);

	if (!verify) return { requested: usable.length, skipped, done: [], pending: usable.map((f) => f._id) };

	const { done, pending } = await verifyTrialFonts({
		client,
		fonts: usable,
		config,
		timeoutMs,
		onProgress: (p) => { if (onProgress) onProgress({ type: 'trial-progress', ...p }); },
	});

	if (onProgress) onProgress({ type: 'trial-complete', done: done.length, pending: pending.length, total: usable.length });
	if (pending.length) {
		console.warn(`Trial font generation did not confirm for ${pending.length} of ${usable.length} fonts within the timeout`);
	}

	return { requested: usable.length, skipped, done, pending };
}
