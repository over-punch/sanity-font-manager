// Patches the parent typeface document's styles.fonts array with newly uploaded font references

import { nanoid } from 'nanoid';

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

	let patch = {
		'styles.fonts': dedupeRefs(stylesObject.fonts, fontRefs),
		'styles.variableFont': dedupeRefs(stylesObject?.variableFont, variableRefs),
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

	patch['styles.subfamilies'] = subfamiliesArray;

	// Optionally update preferred style
	await updatePreferredStyle(doc_id, preferredStyleRef, newPreferredStyle, patch, client);

	console.log('doc_id: ', doc_id);
	console.log('Typeface patch: ', patch);
	console.log('New preferred style: ', newPreferredStyle);
	console.log('SubfamiliesArray:', subfamiliesArray);

	try {
		await client.patch(doc_id).set(patch).commit();
		console.log(`Updated document: ${doc_id}`);

		if (doc_id.startsWith('drafts.')) {
			await updatePublishedDocument(doc_id, patch, client);
		}
	} catch (err) {
		console.error('Error updating document:', err.message);
		setStatus('Error updating typeface');
		setError(true);
	}
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
	const publishedDoc = await client.fetch(`*[_id == $publishedId]`, { publishedId }).then(res => res[0]);

	if (publishedDoc) {
		await client.patch(publishedId).set(patch).commit();
		console.log(`Updated published document: ${publishedId}`);
	} else {
		console.log(`No published document found for ${publishedId}, skipping`);
	}
};
