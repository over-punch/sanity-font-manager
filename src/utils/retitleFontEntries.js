// Lightweight retitle pass — re-derives title, documentId, weightName, and
// subfamilyName from cached parsedMetadata when preserveShortenedNames changes.
// No fontkit parsing, no file I/O, no Sanity queries — pure string manipulation.

import { expandAbbreviations, generateStyleKeywords } from './generateKeywords.js';
import { formatFontTitle, addItalicToFontTitle, processSubfamilyName } from './processFontFiles.js';
import { sanitizeForSanityId } from './sanitizeForSanityId.js';

const { weightKeywordList: WEIGHT_KW, italicKeywordList: ITALIC_KW } = generateStyleKeywords();

/**
 * Re-derive title, documentId, weightName, and subfamilyName for a single
 * font entry using cached metadata and the new preserveShortenedNames setting.
 * Skips entries with user overrides on title (user edits take precedence).
 *
 * @param {object} entry - Font plan entry with parsedMetadata and decisions
 * @param {boolean} preserveShortenedNames - New setting value
 * @param {string} typefaceTitle - Parent typeface title (for prefix stripping)
 * @returns {object} Updated entry (shallow copy if changed, same ref if unchanged)
 */
export function retitleFontEntry(entry, preserveShortenedNames, typefaceTitle) {
	if (!entry || !entry.parsedMetadata) return entry;

	// Skip entries with user overrides on title — user edits take precedence
	if (entry.decisions?.title?.userOverride) return entry;

	const meta = entry.parsedMetadata;
	const fullName = meta.fullName || '';
	const familyName = meta.familyName || '';
	const trimmedTitle = (typefaceTitle || '').trim();

	// Re-derive weightName from the original detected value
	let weightName = entry.decisions?.weightName?.detected || entry.weightName || '';
	if (!preserveShortenedNames) {
		weightName = expandAbbreviations(weightName);
	}

	// Re-derive subfamilyName
	const nameId4Remainder = fullName ? fullName.replace(trimmedTitle, '').trim() : '';
	const nameId1Remainder = familyName ? familyName.replace(trimmedTitle, '').trim() : '';
	let subfamilyName = nameId4Remainder || nameId1Remainder;

	if (!preserveShortenedNames) {
		subfamilyName = expandAbbreviations(subfamilyName);
	}

	subfamilyName = processSubfamilyName(subfamilyName, WEIGHT_KW, ITALIC_KW, preserveShortenedNames);

	// Strip style-only names from subfamily
	subfamilyName = subfamilyName
		.replace(/\b(Italic|Slant|Slanted|Oblique|Backslant|Roman|Upright)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();

	// Strip subfamily from weightName to avoid duplication
	if (subfamilyName !== '') {
		weightName = weightName
			.replace(`${subfamilyName} `, '')
			.replace(` ${subfamilyName}`, '')
			.trim();
	}

	// Re-derive title
	let fontTitle = fullName.trim() || '';
	fontTitle = formatFontTitle(fontTitle, preserveShortenedNames);

	// Variable fonts get " VF" suffix
	if (entry.variableFont) {
		if (!fontTitle.toLowerCase().includes('vf')) {
			fontTitle = fontTitle + ' VF';
		}
		subfamilyName = '';
	}

	// Add italic suffix if needed
	if (!(entry.variableFont && fontTitle.toLowerCase().includes('italic'))) {
		// Build a minimal font-like object for addItalicToFontTitle
		const italicKW = entry.parsedMetadata.italicAngle !== 0 ? 'Italic' : '';
		fontTitle = addItalicToFontTitle(
			{ opentype: { tables: { post: { italicAngle: entry.parsedMetadata.italicAngle || 0 } } } },
			fontTitle,
			italicKW,
			entry.style,
			preserveShortenedNames
		);
	}

	const documentId = sanitizeForSanityId(fontTitle);

	// Only return a new object if something actually changed
	if (
		entry.title === fontTitle &&
		entry.documentId === documentId &&
		entry.weightName === weightName &&
		entry.subfamily === (entry.variableFont ? '' : (subfamilyName || 'Regular'))
	) {
		return entry;
	}

	const finalSubfamily = entry.variableFont ? '' : (subfamilyName || 'Regular');

	return {
		...entry,
		title: fontTitle,
		documentId,
		weightName,
		subfamily: finalSubfamily,
		decisions: {
			...entry.decisions,
			title: { ...entry.decisions.title, processed: fontTitle },
			documentId: { ...entry.decisions.documentId, generated: documentId },
			weightName: { ...entry.decisions.weightName, detected: weightName },
			subfamily: { ...entry.decisions.subfamily, detected: finalSubfamily },
		},
	};
}

/**
 * Retitle all font entries in a plan. Returns a new fonts map.
 * Runs collision detection after retitling.
 *
 * @param {object} fonts - plan.fonts map
 * @param {boolean} preserveShortenedNames
 * @param {string} typefaceTitle
 * @returns {object} New fonts map with updated titles and _idConflict flags
 */
export function retitleAllFonts(fonts, preserveShortenedNames, typefaceTitle) {
	const updated = {};
	for (const [tempId, entry] of Object.entries(fonts)) {
		updated[tempId] = retitleFontEntry(entry, preserveShortenedNames, typefaceTitle);
	}

	// Run collision detection
	const idMap = {};
	for (const [tempId, font] of Object.entries(updated)) {
		updated[tempId] = { ...font, _idConflict: false };
		const docId = font.documentId;
		if (!idMap[docId]) {
			idMap[docId] = [tempId];
		} else {
			idMap[docId].push(tempId);
		}
	}

	for (const ids of Object.values(idMap)) {
		if (ids.length > 1) {
			for (const id of ids) {
				updated[id] = { ...updated[id], _idConflict: true };
			}
		}
	}

	return updated;
}
