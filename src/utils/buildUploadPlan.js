// Phase 1 orchestrator — parses font files, resolves existing documents, builds a complete upload plan for user review

import { nanoid } from 'nanoid';
import { parseFont } from './parseFont';
import { readFontFile, extractFontMetadata, determineWeight } from './processFontFiles';
import {
	getNameString,
	getFontMetadata,
	getFontMetrics,
	getVariationAxes,
	getNamedInstances,
	getAllFeatureTags,
	getGlyphCount,
	getCharacterSet,
	getItalicAngle,
	getWeightClass,
} from './fontHelpers';
import { resolveExistingFont } from './resolveExistingFont';
import { sanitizeForSanityId } from './sanitizeForSanityId';
import {
	FONT_STATUS,
	PLAN_PHASE,
	RECOMMENDATION,
	PLAN_VERSION,
	createFontDecisions,
	createEmptyPlan,
} from './planTypes';

/**
 * Phase 1: Reads font files, parses metadata, resolves existing documents,
 * returns a complete upload plan for user review.
 *
 * NOTE: This function performs Sanity READ operations (existing document lookups)
 * but NO writes. The client parameter is used for reads only.
 *
 * @param {object} params
 * @param {File[]} params.files - Font files to process
 * @param {string} params.typefaceTitle - Parent typeface title
 * @param {string} params.docId - Typeface document _id (for scoping resolution queries)
 * @param {object} params.settings - { price, preserveShortenedNames, preserveFileNames }
 * @param {object} params.client - Sanity client (read-only usage)
 * @param {object} params.stylesObject - Existing typeface styles
 * @param {string[]} params.weightKeywordList - Weight keywords for extraction
 * @param {string[]} params.italicKeywordList - Italic keywords for extraction
 * @param {function} params.onProgress - Called after each font is processed
 * @returns {Promise<object>} UploadPlan object
 */
export async function buildUploadPlan({
	files,
	typefaceTitle,
	docId,
	settings = {},
	client,
	stylesObject = {},
	weightKeywordList = [],
	italicKeywordList = [],
	onProgress,
}) {
	const plan = createEmptyPlan(settings);
	plan.phase = PLAN_PHASE.PROCESSING;
	plan.processingProgress.total = files.length;

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		plan.processingProgress.currentFile = file.name;

		try {
			const fontBuffer = await readFontFile(file);
			const font = await parseFont(fontBuffer, file.name);

			const entry = await buildFontPlanEntry({
				file,
				font,
				typefaceTitle,
				settings: plan.settings,
				weightKeywordList,
				italicKeywordList,
				client,
			});

			// Merge into plan — if same documentId, merge files
			const existingKey = Object.keys(plan.fonts).find(k => plan.fonts[k].documentId === entry.documentId);
			if (existingKey) {
				plan.fonts[existingKey].files = [...plan.fonts[existingKey].files, ...entry.files];
			} else {
				plan.fonts[entry.tempId] = entry;

				// Add to subfamily group
				if (!entry.variableFont || entry.subfamily) {
					const sfName = entry.subfamily;
					if (!plan.subfamilyGroups[sfName]) {
						plan.subfamilyGroups[sfName] = { title: sfName, fontIds: [] };
					}
					plan.subfamilyGroups[sfName].fontIds.push(entry.tempId);
				}
			}

			plan.processingProgress.completed++;

			if (onProgress) {
				onProgress({
					type: 'font-processed',
					tempId: entry.tempId,
					fontEntry: entry,
					progress: { ...plan.processingProgress },
				});
			}
		} catch (err) {
			console.error(`Error processing ${file.name}:`, err.message);
			plan.processingProgress.failed++;

			const errorTempId = sanitizeForSanityId(file.name) + '-' + nanoid(6);
			plan.fonts[errorTempId] = {
				tempId: errorTempId,
				files: [file],
				sourceFileName: file.name,
				title: file.name,
				documentId: '',
				weight: 400,
				weightName: '',
				style: 'Regular',
				subfamily: '',
				variableFont: false,
				originalFilename: null,
				decisions: createFontDecisions({}),
				status: FONT_STATUS.ERROR,
				error: err.message,
				parsedMetadata: null,
				glyphCount: 0,
				opentypeFeatures: [],
				variationAxes: null,
			};

			if (onProgress) {
				onProgress({
					type: 'font-error',
					tempId: errorTempId,
					error: err.message,
					progress: { ...plan.processingProgress },
				});
			}
		}
	}

	plan.processingProgress.currentFile = null;
	plan.phase = PLAN_PHASE.REVIEWING;

	if (onProgress) {
		onProgress({
			type: 'processing-complete',
			progress: { ...plan.processingProgress },
		});
	}

	return plan;
}

/**
 * Builds a single FontPlanEntry from a parsed font file.
 * @param {object} params
 * @returns {Promise<object>} FontPlanEntry
 */
async function buildFontPlanEntry({
	file,
	font,
	typefaceTitle,
	settings,
	weightKeywordList,
	italicKeywordList,
	client,
}) {
	// Extract metadata using existing processFontFiles helpers
	const { weightName, subfamilyName, fontTitle, style, italicKW, variableFont } = extractFontMetadata(
		font,
		typefaceTitle,
		weightKeywordList,
		italicKeywordList,
		settings.preserveShortenedNames,
	);

	// Determine title and ID based on preserveFileNames setting
	let finalTitle = fontTitle;
	let originalFilename = null;

	if (settings.preserveFileNames) {
		originalFilename = file.name.replace(/\.(ttf|otf|woff2?|eot|svg)$/i, '');
		const normalizedName = originalFilename
			.replace(/-/g, ' ')
			.replace(/([a-z])([A-Z])/g, '$1 $2')
			.replace(/\s+/g, ' ')
			.trim();
		finalTitle = normalizedName;
	}

	const documentId = sanitizeForSanityId(finalTitle);
	const tempId = documentId + '-' + nanoid(6);
	const weight = Number(determineWeight(font, weightName));

	// Build title alternatives from all name sources
	const titleAlternatives = [
		{ value: getNameString(font, 1), source: 'nameId1-familyName' },
		{ value: getNameString(font, 4), source: 'nameId4-fullName' },
		{ value: getNameString(font, 6), source: 'nameId6-postscriptName' },
		{ value: getNameString(font, 16), source: 'nameId16-preferredFamily' },
		{ value: getNameString(font, 17), source: 'nameId17-preferredSubfamily' },
		{ value: file.name.replace(/\.(ttf|otf|woff2?|eot|svg)$/i, ''), source: 'filename' },
	].filter(alt => alt.value);

	// Determine title source
	const titleSource = settings.preserveFileNames ? 'filename' : 'fontkit-fullName';

	// Determine weight source
	const usWeightClass = getWeightClass(font);
	const weightSource = usWeightClass ? 'os2-usWeightClass' : 'keyword-match';
	const matchedKeyword = usWeightClass ? null : weightName;

	// Determine weight name source — nameId17 (preferredSubfamily) or nameId2 (fontSubfamily)
	const nameId17 = getNameString(font, 17);
	const weightNameSource = variableFont
		? 'variable-font-empty'
		: nameId17
			? 'nameId17-preferredSubfamily'
			: 'nameId2-fontSubfamily';

	// Determine style source
	const italicAngle = getItalicAngle(font);
	const fullName = getNameString(font, 4);
	let styleSource = 'default-regular';
	let styleReason = '';
	if (style === 'Italic') {
		if (italicAngle !== 0) {
			styleSource = 'italic-angle';
			styleReason = `italicAngle = ${italicAngle}`;
		} else if (fullName.toLowerCase().includes('italic')) {
			styleSource = 'name-contains-italic';
			styleReason = 'fullName contains "italic"';
		}
	}

	// Determine subfamily source — mirrors the logic in extractFontMetadata
	const familyNameRaw = getNameString(font, 1);
	const nameId4Remainder = fullName ? fullName.replace(typefaceTitle.trim(), '').trim() : '';
	const nameId1Remainder = familyNameRaw ? familyNameRaw.replace(typefaceTitle.trim(), '').trim() : '';
	let subfamilySource = 'default-empty';
	if (nameId4Remainder && subfamilyName) {
		subfamilySource = 'nameId4-subtraction';
	} else if (nameId1Remainder && subfamilyName) {
		subfamilySource = 'nameId1-subtraction';
	}

	// Build decisions audit trail
	const decisions = createFontDecisions({
		titleSource,
		title: finalTitle,
		titleOriginal: getNameString(font, 4),
		documentId,
		weight,
		weightSource,
		matchedKeyword,
		weightName,
		weightNameSource,
		style,
		styleSource,
		styleReason,
		subfamily: subfamilyName,
		subfamilySource,
		titleAlternatives,
	});

	// Resolve existing document
	const fontForResolution = {
		_id: documentId,
		typefaceName: typefaceTitle,
		weightName,
		style,
		subfamily: subfamilyName,
		variableFont,
		title: finalTitle,
	};

	try {
		const resolution = await resolveExistingFont(fontForResolution, client);
		decisions.existingDocument = {
			recommendation: resolution.recommendation,
			exact: resolution.exact,
			candidates: resolution.candidates,
			userChoice: null,
			selectedCandidate: null,
			lookupFailed: resolution.lookupFailed || false,
		};
	} catch (err) {
		console.warn('Document resolution failed for', documentId, err.message);
		decisions.existingDocument.lookupFailed = true;
	}

	// Extract parsed metadata snapshot (no raw fontkit/lib-font object retained)
	const metadata = getFontMetadata(font);
	const metrics = getFontMetrics(font);
	const axes = getVariationAxes(font);

	// Default empty subfamily to "Regular" — matches Regenerate Subfamilies behavior
	const finalSubfamily = variableFont ? '' : (subfamilyName || 'Regular');
	console.log(`[buildFontPlanEntry] "${finalTitle}" → subfamily: "${subfamilyName}" → final: "${finalSubfamily}" (variableFont: ${variableFont})`);

	return {
		tempId,
		files: [file],
		sourceFileName: file.name,
		title: finalTitle,
		documentId,
		weight,
		weightName,
		style,
		subfamily: finalSubfamily,
		variableFont,
		originalFilename,
		decisions,
		status: FONT_STATUS.PROCESSED,
		error: null,
		parsedMetadata: { ...metadata, ...metrics },
		glyphCount: getGlyphCount(font),
		opentypeFeatures: getAllFeatureTags(font),
		variationAxes: axes,
	};
}
