// Requests DS-WEB fingerprinted web copies and display subsets for uploaded fonts, then verifies they landed.
import { withTimeout } from './planTypes';

/**
 * Default number of fonts requested at once. The work is server-side WOFF2 subsetting, so a large
 * family fired off in one burst would swamp the site's function concurrency.
 */
const DEFAULT_CONCURRENCY = 4;
/** How long to wait for the worker to finish writing before giving up, in ms. */
const DEFAULT_TIMEOUT_MS = 180000;
/** Gap between verification polls, in ms. */
const POLL_INTERVAL_MS = 4000;
/**
 * How long a single fontWorker request may stay open before it is aborted, in ms. Generous enough
 * for real subsetting on a cold function; the point is only to guarantee the promise settles.
 */
const REQUEST_TIMEOUT_MS = 60000;

/**
 * Asks the consuming site's fontWorker to build the web copy and subset for one font.
 *
 * The Studio and the site are different origins, so this is a `no-cors` POST — the response is
 * opaque and cannot be read. Success is therefore established by polling Sanity afterwards
 * (see `verifyWebAndSubset`), not by the fetch resolving.
 *
 * A single `generate-subset` call produces BOTH `fileInput.woff2_web` and `fileInput.woff2_subset`
 * and patches them onto the font document server-side.
 *
 * @param {object} params
 * @param {string} params.siteUrl - base URL of the consuming site (SANITY_STUDIO_SITE_URL)
 * @param {object} params.font - { _id, title, woff2Url, filename, variableFont, style, weight }
 * @param {number} [params.timeoutMs] - abort the request after this long
 * @returns {Promise<void>} rejects on network failure or timeout; callers warn and continue
 */
export async function requestWebAndSubset({ siteUrl, font, timeoutMs = REQUEST_TIMEOUT_MS }) {
	// Abort rather than wait forever. An opaque no-cors response cannot be inspected, so a server
	// that accepts the connection and never answers — a function hitting its platform ceiling, a
	// proxy holding the socket — leaves this promise permanently unsettled, and the Promise.all
	// over the chunk never resolves. That stalls the whole run with no error and no recovery.
	//
	// Safe to abort because success is never established by this response: verifyWebAndSubset
	// polls Sanity for the derived files afterwards. Cancelling the request does not cancel the
	// server-side subsetting, so a slow worker still lands and is still picked up by the poll.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		await fetch(`${siteUrl}/api/sanity/fontWorker`, {
			method: 'POST',
			mode: 'no-cors',
			signal: controller.signal,
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				code: 'generate-subset',
				woff2Url: font.woff2Url,
				filename: font.filename,
				documentId: font._id,
				documentTitle: font.title,
				documentVariableFont: font.variableFont,
				documentStyle: font.style,
				documentWeight: font.weight,
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
 * Polls Sanity until every id has the derived files it is waiting on, or the timeout expires.
 *
 * Only `woff2_web` is required by default. Requiring `woff2_subset` too means the poll can only
 * succeed on a site whose fontWorker actually writes it — and where it does not, every run burns
 * the entire timeout waiting for a field that is never coming, then reports the whole batch as
 * pending. That silent full-timeout wait, displayed as the typeface patch still running, is what
 * MCKL reported as the uploader hanging. Studios whose worker produces both can opt in.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string[]} params.ids - font document ids to watch
 * @param {number} [params.timeoutMs]
 * @param {boolean} [params.requireSubset] - also wait for `fileInput.woff2_subset`
 * @param {function} [params.onProgress] - called with { done, total }
 * @returns {Promise<{done: string[], pending: string[]}>}
 */
export async function verifyWebAndSubset({ client, ids, timeoutMs = DEFAULT_TIMEOUT_MS, requireSubset = false, onProgress }) {
	const started = Date.now();
	const deadline = started + timeoutMs;
	let done = [];
	let pending = [...ids];
	let polls = 0;

	const predicate = requireSubset
		? 'defined(fileInput.woff2_web) && defined(fileInput.woff2_subset)'
		: 'defined(fileInput.woff2_web)';

	console.log(`Web/subset: verifying ${ids.length} fonts (${requireSubset ? 'web + subset' : 'web only'}), polling every ${POLL_INTERVAL_MS}ms for up to ${Math.round(timeoutMs / 1000)}s`);

	while (pending.length && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		polls++;
		let complete = [];
		try {
			complete = await client.fetch(
				`*[_type == "font" && _id in $ids && ${predicate}]._id`,
				{ ids: pending }
			);
		} catch (err) {
			console.warn('Web/subset verification query failed:', err.message);
			continue;
		}
		if (complete.length) {
			const finished = new Set(complete);
			done = [...done, ...complete];
			pending = pending.filter((id) => !finished.has(id));
			console.log(`Web/subset: poll ${polls} — ${done.length}/${ids.length} confirmed (${Date.now() - started}ms elapsed)`);
			if (onProgress) onProgress({ done: done.length, total: ids.length });
		} else if (polls % 5 === 0) {
			// Heartbeat on an otherwise silent poll, so a stalled worker is visibly stalled rather
			// than just quiet.
			console.log(`Web/subset: poll ${polls} — still ${pending.length} pending (${Date.now() - started}ms elapsed)`);
		}
	}

	console.log(`Web/subset: verification finished after ${polls} polls in ${Date.now() - started}ms — ${done.length} confirmed, ${pending.length} pending`);
	return { done, pending };
}

/**
 * Reads back the font documents that need derived files, shaped for `generateWebAndSubset`.
 *
 * Works from the persisted documents rather than the in-memory plan, so it reflects what actually
 * landed. Fonts with no WOFF2, or that already have both derived files, are left out.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string[]} params.ids - font document ids
 * @param {boolean} [params.force] - include fonts that already have both files
 * @returns {Promise<object[]>} fonts ready to pass to `generateWebAndSubset`
 */
export async function collectFontsForGeneration({ client, ids = [], force = false, requireSubset = false }) {
	if (!ids.length) return [];
	const started = Date.now();
	const docs = await withTimeout(client.fetch(
		`*[_type == "font" && _id in $ids]{
			_id, title, variableFont, style, weight,
			"woff2Url": fileInput.woff2.asset->url,
			"filename": coalesce(slug.current, _id),
			"hasWeb": defined(fileInput.woff2_web),
			"hasSubset": defined(fileInput.woff2_subset)
		}`,
		{ ids }
	), REQUEST_TIMEOUT_MS, 'Web/subset font lookup');

	// What counts as "already done" has to match what the verifier waits for. Judging completeness
	// on a field the site never writes leaves every font eligible forever, so each upload re-runs
	// the server-side subsetting for fonts that were finished the first time.
	const isComplete = (d) => (requireSubset ? d.hasWeb && d.hasSubset : d.hasWeb);
	const usable = docs
		.filter((d) => d.woff2Url && (force || !isComplete(d)))
		.map(({ hasWeb, hasSubset, ...font }) => font);

	console.log(`Web/subset: read ${docs.length} of ${ids.length} font documents in ${Date.now() - started}ms, ${usable.length} need generating`);
	return usable;
}

/**
 * Generates web copies and subsets for a batch of fonts, throttled, then reports what landed.
 *
 * Never throws — a family that uploaded cleanly should not be reported as failed because a derived
 * web file could not be built. Callers surface `failed`/`pending` as a warning.
 *
 * Requires the consuming site to implement `POST /api/sanity/fontWorker` with the `generate-subset`
 * code, and its `font` schema to define `fileInput.woff2_web` and `fileInput.woff2_subset`. Studios
 * without both should leave this switched off.
 *
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string} params.siteUrl - base URL of the consuming site
 * @param {object[]} params.fonts - [{ _id, title, woff2Url, filename, variableFont, style, weight }]
 * @param {number} [params.concurrency]
 * @param {number} [params.timeoutMs]
 * @param {boolean} [params.verify] - poll Sanity to confirm the files landed (default true)
 * @param {boolean} [params.requireSubset] - only confirm a font once `woff2_subset` lands too;
 *   leave off unless the site's fontWorker demonstrably writes that field, or every run waits out
 *   the full timeout for a file that never arrives
 * @param {function} [params.onProgress] - called with { type, ... }
 * @returns {Promise<{requested: number, skipped: number, done: string[], pending: string[]}>}
 */
export async function generateWebAndSubset({
	client,
	siteUrl,
	fonts = [],
	concurrency = DEFAULT_CONCURRENCY,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	verify = true,
	requireSubset = false,
	onProgress,
}) {
	const usable = fonts.filter((f) => f?._id && f?.woff2Url);
	const skipped = fonts.length - usable.length;

	if (!siteUrl) {
		console.warn('Web/subset generation skipped: no site URL configured');
		return { requested: 0, skipped: fonts.length, done: [], pending: [] };
	}
	if (!usable.length) return { requested: 0, skipped, done: [], pending: [] };

	if (onProgress) onProgress({ type: 'web-subset-start', total: usable.length, skipped });

	// Announce the shape of the work up front. This phase is the slowest part of a large upload —
	// server-side subsetting, `concurrency` at a time — so without a timeline in the console a
	// legitimately slow run is indistinguishable from a stalled one.
	const chunkCount = Math.ceil(usable.length / concurrency);
	const fanOutStart = Date.now();
	console.log(`Web/subset: requesting ${usable.length} fonts in ${chunkCount} chunks of ${concurrency} from ${siteUrl}`);

	// Throttled fan-out — the worker does real subsetting work per font.
	for (let i = 0; i < usable.length; i += concurrency) {
		const chunk = usable.slice(i, i + concurrency);
		const chunkStart = Date.now();
		await Promise.all(
			chunk.map((font) =>
				requestWebAndSubset({ siteUrl, font }).catch((err) => {
					console.warn(`Web/subset request failed for ${font.title}:`, err.message);
				})
			)
		);
		console.log(`Web/subset: chunk ${Math.floor(i / concurrency) + 1}/${chunkCount} done in ${Date.now() - chunkStart}ms (${Date.now() - fanOutStart}ms elapsed)`);
		if (onProgress) onProgress({ type: 'web-subset-requested', requested: Math.min(i + concurrency, usable.length), total: usable.length });
	}

	console.log(`Web/subset: all ${usable.length} requests sent in ${Date.now() - fanOutStart}ms`);

	if (!verify) return { requested: usable.length, skipped, done: [], pending: usable.map((f) => f._id) };

	const { done, pending } = await verifyWebAndSubset({
		client,
		ids: usable.map((f) => f._id),
		timeoutMs,
		requireSubset,
		onProgress: (p) => { if (onProgress) onProgress({ type: 'web-subset-progress', ...p }); },
	});

	if (onProgress) onProgress({ type: 'web-subset-complete', done: done.length, pending: pending.length, total: usable.length });
	if (pending.length) {
		console.warn(`Web/subset generation did not confirm for ${pending.length} of ${usable.length} fonts within the timeout`);
	}

	return { requested: usable.length, skipped, done, pending };
}
