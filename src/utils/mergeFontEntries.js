// Merges duplicate font plan entries into one — combines their file sets and keeps the primary entry's reviewed values

/**
 * Font file extensions the executor knows how to upload, in the order they should be
 * uploaded. Mirrors `determineFileType` in executeUploadPlan.js — anything not listed
 * here is silently skipped at execution, so it is dropped during a merge instead.
 */
export const MERGEABLE_FILE_TYPES = ['ttf', 'otf', 'woff', 'woff2', 'eot', 'svg'];

/**
 * Outline formats that carry a complete, parseable name/metric/feature set. Metadata is only
 * regenerated at execution when one of these survives (see executeUploadPlan.js), so the merged
 * entry takes its binary-derived fields from whichever source supplies the surviving outline.
 */
export const OUTLINE_FILE_TYPES = ['ttf', 'otf'];

/** Fields derived from the font binary rather than from curator input */
const BINARY_DERIVED_FIELDS = ['parsedMetadata', 'glyphCount', 'opentypeFeatures', 'variationAxes'];

/**
 * Returns the canonical file type for a file, or null when the executor cannot upload it.
 * @param {File|{name: string}} file
 * @returns {string|null}
 */
export function fileTypeOf(file) {
	const ext = file?.name?.split('.').pop()?.toLowerCase();
	return MERGEABLE_FILE_TYPES.includes(ext) ? ext : null;
}

/**
 * Lists the file types that more than one entry supplies — the cases a merge has to choose between.
 * @param {object[]} entries - Font plan entries
 * @returns {Object<string, Array<{tempId: string, fileName: string}>>} Type → contributing entries
 */
export function findFileTypeCollisions(entries) {
	const byType = {};
	for (const entry of entries) {
		const seen = new Set();
		for (const file of entry.files || []) {
			const type = fileTypeOf(file);
			// One entry can only contribute one file per type — a second is a duplicate within
			// that entry, not a cross-entry collision.
			if (!type || seen.has(type)) continue;
			seen.add(type);
			if (!byType[type]) byType[type] = [];
			byType[type].push({ tempId: entry.tempId, fileName: file.name });
		}
	}

	const collisions = {};
	for (const [type, contributors] of Object.entries(byType)) {
		if (contributors.length > 1) collisions[type] = contributors;
	}
	return collisions;
}

/**
 * Merges two or more font plan entries into a single entry.
 *
 * The primary entry supplies every reviewed value — title, document ID, weight, style,
 * subfamily and the whole decisions audit trail including its existing-document resolution.
 * The other entries contribute only their font files. Binary-derived fields follow the
 * surviving outline file, because that is the file execution re-parses for metadata.
 *
 * @param {object[]} entries - Two or more font plan entries
 * @param {object} [options]
 * @param {string} [options.primaryTempId] - Entry whose reviewed values survive; defaults to the first
 * @param {Object<string, string>} [options.fileSources] - File type → tempId of the entry whose file wins
 * @returns {{ merged: object, report: object }}
 */
export function mergeFontEntries(entries, { primaryTempId, fileSources = {} } = {}) {
	if (!Array.isArray(entries) || entries.length === 0) {
		throw new Error('mergeFontEntries requires at least one entry');
	}

	const primary = entries.find(e => e.tempId === primaryTempId) || entries[0];

	if (entries.length === 1) {
		return {
			merged: primary,
			report: {
				primaryTempId: primary.tempId,
				mergedTempIds: [],
				files: [],
				dropped: [],
				metadataFromTempId: primary.tempId,
				variableFontChanged: false,
				hasOutlineSource: (primary.files || []).some(f => OUTLINE_FILE_TYPES.includes(fileTypeOf(f))),
			},
		};
	}

	// Primary first so it wins any file type the user did not explicitly assign.
	const ordered = [primary, ...entries.filter(e => e.tempId !== primary.tempId)];

	const claims = {};
	const dropped = [];

	for (const entry of ordered) {
		for (const file of entry.files || []) {
			const type = fileTypeOf(file);

			if (!type) {
				dropped.push({ fileName: file.name, type: null, fromTempId: entry.tempId, reason: 'unsupported-format' });
				continue;
			}

			const held = claims[type];
			if (!held) {
				claims[type] = { file, tempId: entry.tempId };
				continue;
			}

			// A file type can only be claimed once. An explicit choice for this type overrides
			// whoever holds it; otherwise the incumbent keeps it.
			const preferred = fileSources[type];
			if (preferred && preferred === entry.tempId && held.tempId !== entry.tempId) {
				dropped.push({ fileName: held.file.name, type, fromTempId: held.tempId, reason: 'superseded' });
				claims[type] = { file, tempId: entry.tempId };
			} else {
				dropped.push({ fileName: file.name, type, fromTempId: entry.tempId, reason: 'duplicate-format' });
			}
		}
	}

	// Canonical order — the executor uploads in array order and reads the outline for metadata.
	const files = [];
	const fileReport = [];
	for (const type of MERGEABLE_FILE_TYPES) {
		if (!claims[type]) continue;
		files.push(claims[type].file);
		fileReport.push({ type, fileName: claims[type].file.name, fromTempId: claims[type].tempId });
	}

	// Binary-derived fields follow the surviving outline: execution re-parses the TTF/OTF, so the
	// review UI must show what that file says rather than what a webfont's thinner name table said.
	const outlineType = OUTLINE_FILE_TYPES.find(t => claims[t]);
	const metadataTempId = outlineType ? claims[outlineType].tempId : primary.tempId;
	const metadataSource = ordered.find(e => e.tempId === metadataTempId) || primary;

	const merged = {
		...primary,
		files,
		sourceFileName: files[0]?.name || primary.sourceFileName,
		// The merged entry replaces every input, so any stale collision flag goes with them.
		// The reducer recomputes conflicts across the whole plan straight after.
		_idConflict: false,
	};

	if (metadataSource !== primary) {
		for (const field of BINARY_DERIVED_FIELDS) {
			merged[field] = metadataSource[field];
		}
	}

	// variableFont is read from the outline's fvar table, and execution overwrites it from the
	// same file, so the outline's answer is the one that will end up on the document.
	const variableFontChanged = merged.variableFont !== metadataSource.variableFont;
	merged.variableFont = metadataSource.variableFont;

	// Keep whichever original filename exists — the asset naming path needs one when
	// preserveFileNames is on, and the primary may have been built without it.
	if (!merged.originalFilename) {
		merged.originalFilename = ordered.find(e => e.originalFilename)?.originalFilename || null;
	}

	return {
		merged,
		report: {
			primaryTempId: primary.tempId,
			mergedTempIds: ordered.filter(e => e.tempId !== primary.tempId).map(e => e.tempId),
			files: fileReport,
			dropped,
			metadataFromTempId: metadataTempId,
			variableFontChanged,
			hasOutlineSource: Boolean(outlineType),
		},
	};
}
