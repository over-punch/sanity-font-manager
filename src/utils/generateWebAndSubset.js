// Requests DS-WEB fingerprinted web copies and display subsets for uploaded fonts, then verifies they landed.

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
 * @returns {Promise<void>}
 */
export async function requestWebAndSubset({ siteUrl, font }) {
	await fetch(`${siteUrl}/api/sanity/fontWorker`, {
		method: 'POST',
		mode: 'no-cors',
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
}

/**
 * Polls Sanity until every id has both derived files, or the timeout expires.
 * @param {object} params
 * @param {object} params.client - Sanity client
 * @param {string[]} params.ids - font document ids to watch
 * @param {number} [params.timeoutMs]
 * @param {function} [params.onProgress] - called with { done, total }
 * @returns {Promise<{done: string[], pending: string[]}>}
 */
export async function verifyWebAndSubset({ client, ids, timeoutMs = DEFAULT_TIMEOUT_MS, onProgress }) {
	const deadline = Date.now() + timeoutMs;
	let done = [];
	let pending = [...ids];

	while (pending.length && Date.now() < deadline) {
		await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
		let complete = [];
		try {
			complete = await client.fetch(
				`*[_type == "font" && _id in $ids && defined(fileInput.woff2_web) && defined(fileInput.woff2_subset)]._id`,
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
			if (onProgress) onProgress({ done: done.length, total: ids.length });
		}
	}

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
export async function collectFontsForGeneration({ client, ids = [], force = false }) {
	if (!ids.length) return [];
	const docs = await client.fetch(
		`*[_type == "font" && _id in $ids]{
			_id, title, variableFont, style, weight,
			"woff2Url": fileInput.woff2.asset->url,
			"filename": coalesce(slug.current, _id),
			"hasWeb": defined(fileInput.woff2_web),
			"hasSubset": defined(fileInput.woff2_subset)
		}`,
		{ ids }
	);
	return docs
		.filter((d) => d.woff2Url && (force || !d.hasWeb || !d.hasSubset))
		.map(({ hasWeb, hasSubset, ...font }) => font);
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

	// Throttled fan-out — the worker does real subsetting work per font.
	for (let i = 0; i < usable.length; i += concurrency) {
		const chunk = usable.slice(i, i + concurrency);
		await Promise.all(
			chunk.map((font) =>
				requestWebAndSubset({ siteUrl, font }).catch((err) => {
					console.warn(`Web/subset request failed for ${font.title}:`, err.message);
				})
			)
		);
		if (onProgress) onProgress({ type: 'web-subset-requested', requested: Math.min(i + concurrency, usable.length), total: usable.length });
	}

	if (!verify) return { requested: usable.length, skipped, done: [], pending: usable.map((f) => f._id) };

	const { done, pending } = await verifyWebAndSubset({
		client,
		ids: usable.map((f) => f._id),
		timeoutMs,
		onProgress: (p) => { if (onProgress) onProgress({ type: 'web-subset-progress', ...p }); },
	});

	if (onProgress) onProgress({ type: 'web-subset-complete', done: done.length, pending: pending.length, total: usable.length });
	if (pending.length) {
		console.warn(`Web/subset generation did not confirm for ${pending.length} of ${usable.length} fonts within the timeout`);
	}

	return { requested: usable.length, skipped, done, pending };
}
