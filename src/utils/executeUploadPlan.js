// Phase 2 executor — uploads assets, creates/updates font documents, patches the typeface document

import { nanoid } from 'nanoid';
import generateCssFile from './generateCssFile';
import generateFontData from './generateFontData';
import { parseVariableFontInstances } from './parseVariableFontInstances';
import { updateTypefaceDocument } from './updateTypefaceDocument';
import { generateWebAndSubset, collectFontsForGeneration } from './generateWebAndSubset';
import {
	FONT_STATUS,
	EXECUTION_STATUS,
	RECOMMENDATION,
	CONCURRENCY_LIMIT,
	MAX_RETRIES,
	backoffWithJitter,
} from './planTypes';

/**
 * Phase 2: Executes a finalized plan — uploads assets, creates/updates
 * font documents, patches the typeface document.
 *
 * Skips fonts with status 'error'. Caches asset references in progress
 * for idempotent retry on partial failure.
 *
 * @param {object} params
 * @param {object} params.plan - The reviewed and finalized UploadPlan
 * @param {object} params.client - Sanity client
 * @param {string} params.docId - Typeface document _id
 * @param {object} params.stylesObject - Existing typeface styles
 * @param {object} params.preferredStyleRef - Current preferredStyle reference
 * @param {function} params.onProgress - Execution progress callback
 * @returns {Promise<object>} ExecutionResult
 */
export async function executeUploadPlan({
	plan,
	client,
	docId,
	stylesObject = {},
	preferredStyleRef = {},
	onProgress,
}) {
	const result = {
		success: true,
		created: 0,
		updated: 0,
		failed: 0,
		skipped: 0,
		failedFonts: [],
		fontRefs: [],
		variableRefs: [],
		typefacePatchError: null,
	};

	// Build execution queue — skip fonts with processing errors
	const fontEntries = Object.values(plan.fonts);
	const queue = fontEntries.filter(entry => entry.status !== FONT_STATUS.ERROR);
	const skipped = fontEntries.filter(entry => entry.status === FONT_STATUS.ERROR);
	result.skipped = skipped.length;

	// Track per-font execution progress
	const progress = {};
	for (const entry of queue) {
		progress[entry.tempId] = {
			status: EXECUTION_STATUS.QUEUED,
			currentFile: null,
			filesComplete: 0,
			filesTotal: entry.files.length,
			assetRefs: {},
			error: null,
		};
	}

	if (onProgress) {
		onProgress({ type: 'execution-start', totalFonts: queue.length, skippedFonts: result.skipped });
	}

	// Process fonts with concurrency limit
	const chunks = [];
	for (let i = 0; i < queue.length; i += CONCURRENCY_LIMIT) {
		chunks.push(queue.slice(i, i + CONCURRENCY_LIMIT));
	}

	let newPreferredStyle = { weight: -100, style: 'Italic', _ref: '' };
	const subfamilies = {};
	const uniqueSubfamilies = new Set();

	for (const chunk of chunks) {
		const chunkResults = await Promise.allSettled(
			chunk.map(entry => executeSingleFont({
				entry,
				plan,
				client,
				progress,
				onProgress,
			}))
		);

		for (let i = 0; i < chunkResults.length; i++) {
			const chunkResult = chunkResults[i];
			const entry = chunk[i];

			if (chunkResult.status === 'fulfilled' && chunkResult.value) {
				const fontResult = chunkResult.value;

				if (fontResult.isNew) result.created++;
				else result.updated++;

				// Track for typeface patch
				if (entry.variableFont) {
					result.variableRefs.push(fontResult.ref);
				} else {
					result.fontRefs.push(fontResult.ref);
				}

				subfamilies[entry.documentId] = entry.subfamily;
				if (entry.subfamily) uniqueSubfamilies.add(entry.subfamily);

				// Track preferred style candidate
				if (entry.weight > newPreferredStyle.weight) {
					newPreferredStyle = {
						weight: entry.weight,
						style: entry.style,
						_ref: fontResult.ref._ref,
					};
				}
			} else {
				result.failed++;
				result.success = false;
				const errorMsg = chunkResult.reason?.message || chunkResult.value?.error || 'Unknown error';
				result.failedFonts.push({
					tempId: entry.tempId,
					title: entry.title,
					error: errorMsg,
					failedAt: progress[entry.tempId]?.status || 'unknown',
				});
			}
		}
	}

	// Patch the typeface document with new font references
	if (result.fontRefs.length > 0 || result.variableRefs.length > 0) {
		try {
			if (onProgress) {
				onProgress({ type: 'typeface-patching' });
			}

			await updateTypefaceDocument(
				docId,
				result.fontRefs,
				result.variableRefs,
				subfamilies,
				[...uniqueSubfamilies],
				stylesObject?.subfamilies || [],
				preferredStyleRef,
				newPreferredStyle,
				stylesObject,
				client,
				(msg) => { if (onProgress) onProgress({ type: 'typeface-status', message: msg }); },
				(err) => { if (err) console.error('Typeface patch error flag set'); },
			);

			if (onProgress) {
				onProgress({ type: 'typeface-patched' });
			}
		} catch (err) {
			result.typefacePatchError = err.message;
			result.success = false;
			console.error('Typeface patch failed:', err.message);

			if (onProgress) {
				onProgress({ type: 'typeface-error', error: err.message });
			}
		}
	}

	// Build the DS-WEB web copies and display subsets, when the studio has opted in. Off by default:
	// it needs both the `fileInput.woff2_web`/`woff2_subset` schema fields AND a subset-capable
	// /api/sanity/fontWorker on the consuming site. Never fails the run — the fonts themselves are
	// already uploaded, so a missing derived file is a warning, not a failed upload.
	if (plan.settings?.webAndSubset) {
		try {
			// Read back what actually landed rather than trusting the plan, and skip any font that
			// already has both derived files.
			const ids = [...result.fontRefs, ...result.variableRefs].map((r) => r._ref).filter(Boolean);
			const fonts = await collectFontsForGeneration({ client, ids });

			const summary = await generateWebAndSubset({
				client,
				siteUrl: plan.settings.siteUrl || process.env.SANITY_STUDIO_SITE_URL,
				fonts,
				onProgress: (p) => { if (onProgress) onProgress(p); },
			});
			result.webAndSubset = summary;
		} catch (err) {
			console.warn('Web/subset generation failed:', err.message);
			result.webAndSubset = { error: err.message };
		}
	}

	if (onProgress) {
		onProgress({ type: 'execution-complete', result });
	}

	return result;
}

/**
 * Executes upload for a single font entry.
 * Exported for unit testing of the create-vs-update decision and the no-clobber patch.
 * @returns {Promise<{ ref: object, isNew: boolean }>}
 */
export async function executeSingleFont({ entry, plan, client, progress, onProgress }) {
	const fontProgress = progress[entry.tempId];
	fontProgress.status = EXECUTION_STATUS.UPLOADING_ASSETS;

	if (onProgress) {
		onProgress({ type: 'font-upload-start', tempId: entry.tempId, fontProgress: { ...fontProgress } });
	}

	// Determine action based on resolution
	const decision = entry.decisions.existingDocument;
	const userChoice = decision.userChoice;
	const recommendation = decision.recommendation;
	const shouldUpdate = userChoice === 'update' ||
		(!userChoice && (recommendation === RECOMMENDATION.USE_EXACT || recommendation === RECOMMENDATION.USE_CANDIDATE));
	const existingDoc = shouldUpdate
		? (decision.selectedCandidate || decision.exact || decision.candidates[0])
		: null;

	// Upload font files
	const fileInput = {};
	for (let j = 0; j < entry.files.length; j++) {
		const file = entry.files[j];
		const fileType = determineFileType(file);
		if (!fileType) continue;

		// Skip if already uploaded (idempotent retry)
		if (fontProgress.assetRefs[fileType]) {
			fileInput[fileType] = {
				_type: 'file',
				asset: { _type: 'reference', _ref: fontProgress.assetRefs[fileType] },
			};
			fontProgress.filesComplete++;
			continue;
		}

		fontProgress.currentFile = fileType;

		try {
			const assetFilename = plan.settings.preserveFileNames && entry.originalFilename
				? `${entry.originalFilename}.${fileType}`
				: `${entry.documentId}.${fileType}`;

			const baseAsset = await uploadWithRetry(
				() => client.assets.upload('file', file, { filename: assetFilename }),
			);

			// Override Sanity SHA1-dedup originalFilename if needed
			if (plan.settings.preserveFileNames && baseAsset.originalFilename !== assetFilename) {
				try {
					await client.patch(baseAsset._id).set({ originalFilename: assetFilename }).commit();
				} catch (renameErr) {
					console.warn('Could not rename asset:', renameErr.message);
				}
			}

			fileInput[fileType] = {
				_type: 'file',
				asset: { _type: 'reference', _ref: baseAsset._id },
			};
			fontProgress.assetRefs[fileType] = baseAsset._id;
			fontProgress.filesComplete++;

			if (onProgress) {
				onProgress({ type: 'file-uploaded', tempId: entry.tempId, fileType, fontProgress: { ...fontProgress } });
			}
		} catch (err) {
			fontProgress.status = EXECUTION_STATUS.ERROR;
			fontProgress.error = err.message;
			throw new Error(`Asset upload failed for ${fileType}: ${err.message}`);
		}
	}

	// Generate CSS from WOFF2 if available
	if (fileInput.woff2 || fileInput.woff) {
		fontProgress.status = EXECUTION_STATUS.GENERATING_CSS;
		try {
			const woff2File = entry.files.find(f => f.name.endsWith('.woff2') || f.name.endsWith('.woff'));
			if (woff2File) {
				const updatedFileInput = await generateCssFile({
					woff2File,
					fileInput,
					fileName: entry.documentId,
					fontName: entry.title,
					variableFont: entry.variableFont,
					weight: entry.weight,
					style: entry.style,
					client,
				});
				Object.assign(fileInput, updatedFileInput);

				if (onProgress) {
					onProgress({ type: 'css-generated', tempId: entry.tempId, fontProgress: { ...fontProgress } });
				}
			}
		} catch (err) {
			console.warn('CSS generation failed for', entry.title, '— document created without CSS:', err.message);
		}
	}

	// Generate font metadata
	if (fileInput.ttf || fileInput.otf) {
		fontProgress.status = EXECUTION_STATUS.GENERATING_METADATA;
		try {
			const ttfAssetRef = fileInput.ttf?.asset?._ref || fileInput.otf?.asset?._ref;
			if (ttfAssetRef) {
				const metadata = await generateFontData({
					fileInput,
					fontKit: null, // Will re-parse from URL
					fontId: entry.documentId,
					client,
					commit: false, // Don't patch yet — we'll include in the document creation
				});
				Object.assign(entry, {
					metaData: metadata.metaData,
					metrics: metadata.metrics,
					variableAxes: metadata.variableAxes,
					variableInstances: metadata.variableInstances,
					opentypeFeatures: metadata.opentypeFeatures,
					characterSet: metadata.characterSet,
					glyphCount: metadata.glyphCount,
					variableFont: metadata.variableFont,
				});

				if (onProgress) {
					onProgress({ type: 'metadata-generated', tempId: entry.tempId, fontProgress: { ...fontProgress } });
				}
			}
		} catch (err) {
			console.warn('Metadata generation failed for', entry.title, ':', err.message);
		}
	}

	// Create or update font document
	fontProgress.status = EXECUTION_STATUS.CREATING_DOCUMENT;

	// Resolution may have thrown (decision.lookupFailed) — then `shouldUpdate` is falsely false and a blind
	// createOrReplace could DESTROY an existing document. Re-check existence before creating so we can never
	// clobber; if the re-check also fails, skip this font rather than risk overwriting.
	let target = existingDoc;
	let treatAsUpdate = shouldUpdate && !!existingDoc;
	if (!treatAsUpdate && decision.lookupFailed) {
		try {
			target = await client.fetch(
				`*[_type == 'font' && (_id == $id || _id == $draftId || slug.current == $id)][0]{ _id, fileInput, metaData, metrics }`,
				{ id: entry.documentId, draftId: `drafts.${entry.documentId}` }
			);
			if (target?._id) treatAsUpdate = true;
		} catch (recheckErr) {
			throw new Error(`Resolution failed and the existence re-check also failed for "${entry.title}" — skipped to avoid overwriting an existing document.`);
		}
	}

	const fontDocId = treatAsUpdate && target ? target._id : entry.documentId;
	const isNew = !treatAsUpdate;

	// Parsed values a re-upload legitimately refreshes: the font files + everything derived from the binary.
	const refreshFields = {
		fileInput,
		style: entry.style,
		variableFont: entry.variableFont,
		weightName: entry.weightName,
		subfamily: entry.subfamily,
		weight: entry.weight,
	};
	if (entry.metaData) refreshFields.metaData = entry.metaData;
	if (entry.metrics) refreshFields.metrics = entry.metrics;
	if (entry.variableAxes) refreshFields.variableAxes = entry.variableAxes;
	if (entry.variableInstances) refreshFields.variableInstances = entry.variableInstances;
	if (entry.opentypeFeatures) refreshFields.opentypeFeatures = entry.opentypeFeatures;
	if (entry.characterSet) refreshFields.characterSet = entry.characterSet;
	if (entry.glyphCount) refreshFields.glyphCount = entry.glyphCount;

	try {
		if (treatAsUpdate && target) {
			// Partial patch: only file/metadata fields change. Curator-owned fields (price, sell, slug, title,
			// typefaceName, description, scriptFileInput, variableInstanceReferences) are NOT in the set, so
			// `.set()` leaves them untouched — a re-upload of the binary can't reset a sold product's price/URL.
			// Keep any font-file formats that weren't part of this re-upload; fall back to existing metadata.
			if (target.fileInput) {
				Object.keys(target.fileInput).forEach(key => {
					if (!refreshFields.fileInput[key]) refreshFields.fileInput[key] = target.fileInput[key];
				});
			}
			if (!refreshFields.metaData && target.metaData) refreshFields.metaData = target.metaData;
			if (!refreshFields.metrics && target.metrics) refreshFields.metrics = target.metrics;

			await client.patch(target._id).set(refreshFields).commit();
			console.log('Updated existing font (files/metadata only):', target._id, entry.title);
		} else {
			// New document — set the full shape, including the curator-owned fields.
			const fontDoc = {
				_id: fontDocId,
				_type: 'font',
				title: entry.title,
				slug: { _type: 'slug', current: fontDocId },
				typefaceName: plan.settings.typefaceTitle || entry.title,
				// With per-style pricing off, `sell` comes from the setting rather than the price —
				// otherwise a hidden (zero) price would set `sell: false` and silently remove the
				// type-tester buy button on every newly uploaded font.
				price: plan.settings.pricing === false ? 0 : plan.settings.price,
				sell: plan.settings.pricing === false
					? plan.settings.sell !== false
					: plan.settings.price > 0,
				normalWeight: true,
				...refreshFields,
			};
			await client.createOrReplace(fontDoc);
			console.log('Created new font:', fontDocId, entry.title);
		}

		fontProgress.status = EXECUTION_STATUS.COMPLETE;

		if (onProgress) {
			onProgress({ type: 'document-created', tempId: entry.tempId, isNew, fontProgress: { ...fontProgress } });
		}

		return {
			ref: {
				_key: nanoid(),
				_type: 'reference',
				_ref: fontDocId,
				_weak: true,
			},
			isNew,
		};
	} catch (err) {
		fontProgress.status = EXECUTION_STATUS.ERROR;
		fontProgress.error = err.message;
		throw new Error(`Document creation failed: ${err.message}`);
	}
}

/**
 * Determines the file type from a file's extension.
 * @param {File} file
 * @returns {string}
 */
function determineFileType(file) {
	if (file.name.endsWith('.ttf')) return 'ttf';
	if (file.name.endsWith('.otf')) return 'otf';
	if (file.name.endsWith('.woff')) return 'woff';
	if (file.name.endsWith('.woff2')) return 'woff2';
	if (file.name.endsWith('.eot')) return 'eot';
	if (file.name.endsWith('.svg')) return 'svg';
	return '';
}

/**
 * Uploads with exponential backoff + jitter on 429 responses.
 * @param {function} uploadFn - Async function to call
 * @returns {Promise<object>}
 */
async function uploadWithRetry(uploadFn) {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			return await uploadFn();
		} catch (err) {
			const is429 = err.statusCode === 429 || err.status === 429;
			if (is429 && attempt < MAX_RETRIES) {
				const delay = backoffWithJitter(attempt);
				console.warn(`Rate limited (429), retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES})`);
				await new Promise(resolve => setTimeout(resolve, delay));
			} else {
				throw err;
			}
		}
	}
}
