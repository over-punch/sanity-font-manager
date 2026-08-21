// Patches the parent typeface document's styles.fonts array with newly uploaded font references

import { nanoid } from 'nanoid';
import { withTimeout, TYPEFACE_PATCH_TIMEOUT_MS } from './planTypes';

/**
 * Drops references whose font document no longer exists.
 *
 * Reference arrays here are only ever appended to, so a font whose document id changed — a retitle
 * that lands on a new id, leaving the old document deleted — stays referenced forever. The stale
 * reference dereferences to `null`, and a `null` in `styles.subfamilies[].fonts` is enough to fail
 * the whole site build: MCKL's typeface page pairs romans with italics by reading `.weightName`
 * off each entry.
 *
 * A font that exists only as a draft counts as existing — a style mid-creation must not be pruned.
 *
 * @param {Object[]} refs - reference objects carrying `_ref`
 * @param {Set<string>} live - ids known to exist, published or draft
 * @returns {Object[]} the references whose targets are still there
 */
const keepLiveRefs = (refs, live) => (refs || []).filter((ref) => !ref?._ref || live.has(ref._ref));

/**
 * Collects every font id the typeface still resolves, published or draft.
 *
 * One query for the whole patch rather than one per array — a wide family carries hundreds of
 * references across `styles.fonts` and the subfamily groups.
 *
 * @param {Object[]} refArrays - arrays of reference objects to check
 * @param {Object} client - Sanity client
 * @returns {Promise<Set<string>>} ids that exist; empty when the lookup fails
 */
const fetchLiveFontIds = async (refArrays, client) => {
	const ids = [...new Set(refArrays.flat().map((ref) => ref?._ref).filter(Boolean))];
	if (!ids.length) return new Set();

	const draftIds = ids.map((id) => (id.startsWith('drafts.') ? id : `drafts.${id}`));
	const found = await withTimeout(
		client.fetch(`*[_id in $ids || _id in $draftIds]._id`, { ids, draftIds }),
		TYPEFACE_PATCH_TIMEOUT_MS,
		'Stale-reference lookup',
	);

	// Report a draft hit under the published id, which is what the reference stores.
	return new Set(
		(found || [])
			.filter((id) => typeof id === 'string')
			.map((id) => (id.startsWith('drafts.') ? id.slice('drafts.'.length) : id)),
	);
};

/**
 * Patches a typeface document (draft and published) with the new font references,
 * subfamily structure, and preferred style derived from the upload batch.
 *
 * @param {string} doc_id - The Sanity document ID (may be a draft)
 * @param {Object[]} fontRefs - New regular font references
 * @param {Object[]} variableRefs - New variable font references
 * @param {Object} subfamilies - Map of font ID → subfamily name
 * @param {string[]} uniqueSubfamilies
 * @param {Object[]} subfamiliesArray - Existing subfamilies array from the typeface
 * @param {Object} preferredStyleRef - Existing preferred style reference
 * @param {Object} newPreferredStyle - Candidate preferred style from the upload
 * @param {Object} stylesObject - Existing typeface styles object
 * @param {Object} client - Sanity client
 * @param {Function} setStatus
 * @param {Function} setError
 */
export const updateTypefaceDocument = async (
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
) => {
	console.log('Updating typeface document with new fonts:', { fontRefs, variableRefs, subfamilies, uniqueSubfamilies });
	setStatus('Updating typeface references...');

	// Use dot-path keys so .set() does not clobber sibling fields
	// (styles.collections, styles.pairs, styles.free, styles.displayStyles)
	// Deduplicate by _ref to prevent duplicate entries on re-upload
	const dedupeRefs = (existing, incoming) => {
		const merged = [...(existing || [])];
		const existingRefs = new Set(merged.map(r => r._ref).filter(Boolean));
		incoming.forEach(ref => {
			if (ref._ref && !existingRefs.has(ref._ref)) {
				merged.push(ref);
				existingRefs.add(ref._ref);
			}
		});
		return merged;
	};

	const mergedFonts = dedupeRefs(stylesObject.fonts, fontRefs);
	const mergedVariable = dedupeRefs(stylesObject?.variableFont, variableRefs);

	let patch = {
		'styles.fonts': mergedFonts,
		'styles.variableFont': mergedVariable,
	};

	setStatus('Organising font subfamilies...');
	subfamiliesArray = subfamiliesArray || [];

	// Create any missing subfamily groups
	uniqueSubfamilies.forEach(subfamilyName => {
		if (!subfamiliesArray.find(sf => sf.title === subfamilyName)) {
			subfamiliesArray.push({
				title: subfamilyName,
				_key: nanoid(),
				_type: 'object',
				fonts: [],
			});
		}
	});

	// Associate fonts with their subfamily groups (skip VF fonts)
	if (subfamiliesArray.length > 0) {
		Object.entries(subfamilies).forEach(([id, subfamilyName]) => {
			if (id.toLowerCase().includes('vf')) return;

			const subfamilyIndex = subfamiliesArray.findIndex(sf => sf.title === subfamilyName);
			if (subfamilyIndex !== -1) {
				subfamiliesArray[subfamilyIndex].fonts.push({
					_ref: id,
					_key: nanoid(),
					_type: 'reference',
					_weak: true,
				});
			}
		});

		// Deduplicate references within each subfamily
		subfamiliesArray = subfamiliesArray.map(subfamily => ({
			...subfamily,
			fonts: subfamily.fonts.filter((font, index, self) =>
				index === self.findIndex(f => f._ref === font._ref)
			),
		}));
	}

	// Prune references to fonts that no longer exist, across every array this patch writes. Done
	// once here, after the merges, so a stale reference cannot survive in one array while the
	// others are rebuilt — the split that left MCKL's Owners subfamilies pointing at deleted
	// italics while `styles.fonts` stayed clean.
	try {
		const live = await fetchLiveFontIds([mergedFonts, mergedVariable, ...subfamiliesArray.map((sf) => sf.fonts || [])], client);
		if (live.size) {
			patch['styles.fonts'] = keepLiveRefs(mergedFonts, live);
			patch['styles.variableFont'] = keepLiveRefs(mergedVariable, live);
			subfamiliesArray = subfamiliesArray.map((sf) => ({ ...sf, fonts: keepLiveRefs(sf.fonts, live) }));
		}
	} catch (err) {
		// Pruning is housekeeping — never lose the upload over it.
		console.warn('Could not check font references for stale entries:', err.message);
	}

	patch['styles.subfamilies'] = subfamiliesArray;

	// Optionally update preferred style
	await updatePreferredStyle(doc_id, preferredStyleRef, newPreferredStyle, patch, client);

	console.log('doc_id: ', doc_id);
	console.log('Typeface patch: ', patch);
	console.log('New preferred style: ', newPreferredStyle);
	console.log('SubfamiliesArray:', subfamiliesArray);

	// Size the mutation before sending it. An oversized payload is one of the few ways this commit
	// can stall rather than fail, and the numbers are the first thing worth seeing in a bug report.
	console.log('Typeface patch size:', describePatch(patch));

	setStatus('Saving typeface document...');

	try {
		await withTimeout(
			client.patch(doc_id).set(patch).commit(),
			TYPEFACE_PATCH_TIMEOUT_MS,
			'Typeface patch',
		);
		console.log(`Updated document: ${doc_id}`);

		if (doc_id.startsWith('drafts.')) {
			await updatePublishedDocument(doc_id, patch, client);
		}
	} catch (err) {
		// Report through the callbacks the caller supplied, then rethrow. Swallowing here left
		// executeUploadPlan's catch unreachable, so a failed patch surfaced as a successful run —
		// and left UploadSummary's retry button reporting success without retrying anything.
		console.error('Error updating document:', err.message);
		setStatus('Error updating typeface');
		setError(true);
		throw err;
	}
};

/**
 * Summarises a typeface patch for logging — reference counts and serialised byte size.
 * @param {Object} patch - The assembled patch object
 * @returns {{fonts: number, variableFont: number, subfamilyRefs: number, bytes: number}}
 */
const describePatch = (patch) => {
	const subfamilyRefs = (patch['styles.subfamilies'] || []).reduce(
		(total, sf) => total + (sf.fonts?.length || 0),
		0,
	);
	let bytes = 0;
	try {
		bytes = JSON.stringify(patch).length;
	} catch {
		bytes = -1;
	}
	return {
		fonts: (patch['styles.fonts'] || []).length,
		variableFont: (patch['styles.variableFont'] || []).length,
		subfamilyRefs,
		bytes,
	};
};

/**
 * Sets preferredStyle on the patch only when currently empty.
 * Does not overwrite an existing preferredStyle — the user's choice is sticky.
 * @param {string} doc_id
 * @param {Object} preferredStyleRef
 * @param {Object} newPreferredStyle
 * @param {Object} patch
 * @param {Object} client
 */
const updatePreferredStyle = async (doc_id, preferredStyleRef, newPreferredStyle, patch, client) => {
	const isCurrentlyEmpty = !preferredStyleRef?._ref || preferredStyleRef._ref === '' || preferredStyleRef._ref === null;
	const hasCandidate = newPreferredStyle?._ref && newPreferredStyle._ref !== '';

	if (isCurrentlyEmpty && hasCandidate) {
		patch.preferredStyle = {
			_type: 'reference',
			_ref: newPreferredStyle._ref,
			_weak: true,
		};
	}
};

/**
 * Applies the same patch to the published document if it exists.
 * @param {string} doc_id - Draft document ID
 * @param {Object} patch
 * @param {Object} client
 */
const updatePublishedDocument = async (doc_id, patch, client) => {
	const publishedId = doc_id.replace('drafts.', '');
	// Parameterized to prevent injection from any draft ID edge cases
	const publishedDoc = await withTimeout(
		client.fetch(`*[_id == $publishedId]`, { publishedId }),
		TYPEFACE_PATCH_TIMEOUT_MS,
		'Published typeface lookup',
	).then(res => res[0]);

	if (publishedDoc) {
		await withTimeout(
			client.patch(publishedId).set(patch).commit(),
			TYPEFACE_PATCH_TIMEOUT_MS,
			'Published typeface patch',
		);
		console.log(`Updated published document: ${publishedId}`);
	} else {
		console.log(`No published document found for ${publishedId}, skipping`);
	}
};
