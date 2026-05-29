// Core batch upload orchestrator — uploads each format to Sanity, generates CSS and metadata, resolves existing documents, then creates or updates font documents

import { nanoid } from 'nanoid';
import generateCssFile from './generateCssFile';
import generateFontData from './generateFontData';
import { parseVariableFontInstances } from './parseVariableFontInstances';

/**
 * Uploads all font files to Sanity and creates/updates font documents.
 * @param {Object} fontsObjects
 * @param {Object} subfamilies
 * @param {Object} client - Sanity client
 * @param {string} inputPrice
 * @param {Object} stylesObject - Existing typeface styles object
 * @param {Function} setStatus
 * @param {Function} setError
 * @param {boolean} preserveFileNames - Use original filenames for asset naming
 * @returns {Promise<Object>} fontRefs, variableRefs, failedFiles
 */
export const uploadFontFiles = async (
	fontsObjects,
	subfamilies,
	client,
	inputPrice,
	stylesObject,
	setStatus,
	setError,
	preserveFileNames = false,
) => {
	let fontRefs = [];
	let variableRefs = [];
	let failedFiles = [];

	const fontObjectKeys = Object.keys(fontsObjects);

	// Upload files for each font
	for (let i = 0; i < fontObjectKeys.length; i++) {
		const id = fontObjectKeys[i];
		const fontObject = fontsObjects[id];
		const files = fontObject.files;
		const fontKit = fontObject.fontKit;
		let newFileInput = fontObject.fileInput;

		fontObject.subfamily = subfamilies[id] ? subfamilies[id] : '';
		fontObject.price = Number(inputPrice) ? Number(inputPrice) : 0;
		if (fontObject.price > 0) fontObject.sell = true;

		for (let j = 0; j < files.length; j++) {
			const file = files[j];
			const fileType = determineFileType(file);

			// Use original filename for asset naming when preserveFileNames is enabled
			const assetFilename = preserveFileNames && fontObject.originalFilename
				? `${fontObject.originalFilename}.${fileType}`
				: `${fontObject._id}.${fileType}`;

			console.log(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Uploading font file: ${assetFilename}`);
			setStatus(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Uploading font file: ${assetFilename}`);

			try {
				const baseAsset = await client.assets.upload('file', file, { filename: assetFilename });

				// Sanity deduplicates assets by SHA1 hash and reuses the existing asset doc,
				// which means originalFilename may reflect a previous upload. Patch it to
				// match the intended filename so downstream consumers see the correct name.
				if (preserveFileNames && baseAsset.originalFilename !== assetFilename) {
					try {
						await client.patch(baseAsset._id).set({ originalFilename: assetFilename }).commit();
					} catch (renameErr) {
						console.warn('Could not rename asset — permissions may be restricted:', renameErr.message);
					}
				}

				newFileInput[fileType] = {
					_type: 'file',
					asset: { _ref: baseAsset._id, _type: 'reference' },
				};

				if (fileType === 'woff2') {
					console.log(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Generating CSS for: ${fontObject.title}`);
					setStatus(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Generating CSS for: ${fontObject.title}`);
					newFileInput = await generateCssFile({
						woff2File: file,
						fileInput: newFileInput,
						fontName: fontObject.title,
						fileName: fontObject._id,
						variableFont: fontObject.variableFont,
						weight: fontObject.weight,
						client: client,
						style: fontObject.style,
					});
				}

				if (fileType === 'ttf') {
					console.log(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Generating font data for: ${fontObject.title}`);
					setStatus(`[${i + 1}/${fontObjectKeys.length}][${j + 1}/${files.length}] Generating font data for: ${fontObject.title}`);
					const metadata = await generateFontData({
						fontId: fontObject._id,
						url: baseAsset.url,
						fontKit: fontKit,
						client: client,
						commit: false,
					});
					Object.assign(fontObject, metadata);
				}
			} catch (err) {
				console.error('Error uploading font:', fontObject.title, err.message);
				setStatus('Error uploading font: ' + err.message);
				setError(true);
				failedFiles.push({ name: file.name, fk: fontKit });
				continue;
			}

			fontObject.fileInput = newFileInput;
			fontsObjects[id] = fontObject;
		}
	}

	// Create or update Sanity documents
	console.log('Creating/updating Sanity font documents:', fontsObjects);

	for (let i = 0; i < fontObjectKeys.length; i++) {
		const fontId = fontObjectKeys[i];
		const font = fontsObjects[fontId];

		const fontRef = await createOrUpdateFontDocument(font, client, setError);

		if (fontRef) {
			if (!font.variableFont) {
				addToFontRefs(fontRef, font, fontRefs, stylesObject);
			} else {
				addToVariableRefs(fontRef, font, variableRefs, stylesObject);
			}
			console.log(`[${i + 1}/${fontObjectKeys.length}] ${fontRef._ref} created`);
			setStatus(`[${i + 1}/${fontObjectKeys.length}] ${fontRef._ref} created`);
		}
	}

	return { fontRefs, variableRefs, failedFiles };
};

/**
 * Returns the file extension for a font file.
 * @param {File} file
 * @returns {string}
 */
const determineFileType = (file) => {
	if (file.name.endsWith('.otf')) return 'otf';
	if (file.name.endsWith('.ttf')) return 'ttf';
	if (file.name.endsWith('.woff')) return 'woff';
	if (file.name.endsWith('.woff2')) return 'woff2';
	if (file.name.endsWith('.eot')) return 'eot';
	if (file.name.endsWith('.svg')) return 'svg';
	return '';
};

/**
 * Resolves whether a font document already exists in Sanity, returning match details
 * and a recommendation for how to proceed.
 *
 * Resolution strategies (in priority order):
 *   1. Exact _id match or draft _id match or slug.current match
 *   2. Content match by typefaceName + weightName + style + subfamily + variableFont
 *
 * @param {Object} font - The font object with _id, typefaceName, weightName, style, subfamily, variableFont
 * @param {Object} client - Sanity client (parameterized queries only)
 * @returns {Promise<{ exact: Object|null, candidates: Object[], recommendation: string }>}
 */
export const resolveExistingFont = async (font, client) => {
	const result = { exact: null, candidates: [], recommendation: 'create' };

	try {
		// Strategy 1: ID / slug match
		const idMatches = await client.fetch(
			`*[_type == 'font' && (_id == $id || _id == $draftId || slug.current == $id)]{
				_id, title, weight, style, weightName, typefaceName, subfamily, variableFont,
				fileInput, description, metaData, metrics, opentypeFeatures, characterSet,
				scriptFileInput, variableInstanceReferences
			}`,
			{ id: font._id, draftId: `drafts.${font._id}` }
		);

		if (idMatches.length > 0) {
			result.exact = idMatches[0];
			result.recommendation = 'use-exact';
			return result;
		}

		// Strategy 2: Content match (only when ID query returns nothing)
		const subfamily = font.subfamily || '';
		const contentMatches = await client.fetch(
			`*[_type == 'font'
				&& lower(typefaceName) == lower($typefaceName)
				&& lower(weightName) == lower($weightName)
				&& lower(style) == lower($style)
				&& (variableFont == $variableFont || (!defined(variableFont) && $variableFont == false))
				&& (
					lower(coalesce(subfamily, '')) == lower($subfamily)
					|| (lower(coalesce(subfamily, '')) in ['', 'regular'] && lower($subfamily) in ['', 'regular'])
				)
			]{
				_id, title, weight, style, weightName, typefaceName, subfamily, variableFont,
				fileInput, description, metaData, metrics, opentypeFeatures, characterSet,
				scriptFileInput, variableInstanceReferences
			}`,
			{
				typefaceName: font.typefaceName,
				weightName: font.weightName || '',
				style: font.style || 'Regular',
				variableFont: font.variableFont || false,
				subfamily: subfamily === '' ? 'regular' : subfamily,
			}
		);

		if (contentMatches.length === 1) {
			result.candidates = contentMatches;
			result.recommendation = 'use-candidate';
			return result;
		}

		if (contentMatches.length > 1) {
			result.candidates = contentMatches;
			result.recommendation = 'ambiguous';
			console.warn(`Ambiguous font match for "${font.title}" — ${contentMatches.length} candidates found:`,
				contentMatches.map(c => c._id));
			return result;
		}
	} catch (err) {
		console.error('Error resolving existing font:', font._id, err.message);
	}

	return result;
};

/**
 * Creates a new font document or updates an existing one, returning its reference.
 * Uses resolveExistingFont to determine whether to create or update.
 * @param {Object} font
 * @param {Object} client
 * @param {Function} setError
 * @returns {Promise<Object|null>}
 */
const createOrUpdateFontDocument = async (font, client, setError) => {
	try {
		const { exact, candidates, recommendation } = await resolveExistingFont(font, client);

		const { files, fontKit } = font;
		delete font.files;
		delete font.fontKit;
		// Remove temp field used by preserveFileNames — must not be saved to Sanity
		delete font.originalFilename;

		if (font.variableFont && font.variableInstances) {
			const instanceMappings = await parseVariableFontInstances(font, client);
			if (instanceMappings.length > 0) {
				font.variableInstanceReferences = instanceMappings;
			}
		}

		let fontResponse;
		if (recommendation === 'use-exact' && exact) {
			fontResponse = await updateExistingFont(font, exact, client);
		} else if (recommendation === 'use-candidate' && candidates.length === 1) {
			// Reassign font._id to match the existing document so inbound references resolve
			console.log(`Content-match: reassigning "${font._id}" → "${candidates[0]._id}"`);
			font._id = candidates[0]._id;
			fontResponse = await updateExistingFont(font, candidates[0], client);
		} else {
			// 'ambiguous' or 'create' — create a new document
			fontResponse = await createNewFont(font, client);
		}

		return {
			_key: nanoid(),
			_type: 'reference',
			_ref: fontResponse._id,
			_weak: true,
		};
	} catch (e) {
		console.error('Error creating font:', font.title, font.subfamily, e);
		setError(true);
		return null;
	}
};

/**
 * Patches an existing font document, merging file references and preserving stored metadata.
 * @param {Object} font
 * @param {Object} existingFont
 * @param {Object} client
 * @returns {Promise<Object>}
 */
const updateExistingFont = async (font, existingFont, client) => {
	if (existingFont.fileInput) {
		const newFileInput = { ...font.fileInput };
		Object.keys(existingFont.fileInput).forEach(key => {
			if (!newFileInput[key]) newFileInput[key] = existingFont.fileInput[key];
		});
		font.fileInput = newFileInput;
	}

	font.metaData = !font?.metaData || Object.keys(font?.metaData || {}).length === 0
		? existingFont?.metaData || {}
		: font.metaData;
	font.metrics = !font?.metrics || Object.keys(font?.metrics || {}).length === 0
		? existingFont?.metrics || {}
		: font.metrics;
	font.opentypeFeatures = !font?.opentypeFeatures || Object.keys(font?.opentypeFeatures || {}).length === 0
		? existingFont?.opentypeFeatures || {}
		: font.opentypeFeatures;
	font.characterSet = !font?.characterSet || Object.keys(font?.characterSet || {}).length === 0
		? existingFont?.characterSet || {}
		: font.characterSet;
	font.scriptFileInput = existingFont?.scriptFileInput || {};

	cleanMetadataValues(font);

	if (font.variableFont && existingFont?.variableInstanceReferences &&
		(!font.variableInstanceReferences || font.variableInstanceReferences.length === 0)) {
		font.variableInstanceReferences = existingFont.variableInstanceReferences;
	}

	console.log('Updating existing font:', font._id, font.title);

	const patchObject = {
		fileInput: font.fileInput,
		subfamily: font.subfamily,
		weight: font.weight,
	};

	if (font.variableInstanceReferences) {
		patchObject.variableInstanceReferences = font.variableInstanceReferences;
	}

	return await client.patch(font._id).set(patchObject).commit();
};

/**
 * Creates a new font document in Sanity.
 * @param {Object} font
 * @param {Object} client
 * @returns {Promise<Object>}
 */
const createNewFont = async (font, client) => {
	console.log('Creating new font:', font._id, font.title);
	if (font.metaData) cleanMetadataValues(font);

	const newDocument = {
		_key: nanoid(),
		_id: font._id,
		_type: 'font',
		...font,
	};

	return await client.createOrReplace(newDocument);
};

/**
 * Removes null metadata values and strips control characters from string values.
 * @param {Object} font
 */
const cleanMetadataValues = (font) => {
	if (!font.metaData) return;
	Object.keys(font.metaData).forEach(key => {
		if (font.metaData[key] == null) {
			font.metaData[key] = '';
		} else {
			font.metaData[key] = font.metaData[key].replace(/[\x00-\x1f]/g, '');
		}
	});
};

/**
 * Adds a font reference to fontRefs if it's not already in the existing styles.
 * @param {Object} fontRef
 * @param {Object} font
 * @param {Array} fontRefs
 * @param {Object} stylesObject
 */
const addToFontRefs = (fontRef, font, fontRefs, stylesObject) => {
	if (stylesObject.fonts && stylesObject.fonts.length > 0) {
		const fontExists = stylesObject.fonts.findIndex(f => f._ref === fontRef._ref);
		const inFontRefs = fontRefs.findIndex(f => f._ref === fontRef._ref);
		if (fontExists === -1 && inFontRefs === -1) fontRefs.push(fontRef);
	} else {
		fontRefs.push(fontRef);
	}
};

/**
 * Adds a variable font reference to variableRefs if it's not already in the existing styles.
 * @param {Object} fontRef
 * @param {Object} font
 * @param {Array} variableRefs
 * @param {Object} stylesObject
 */
const addToVariableRefs = (fontRef, font, variableRefs, stylesObject) => {
	if (stylesObject?.variableFont?.length) {
		const vfExists = stylesObject.variableFont.findIndex(f => f._ref === fontRef._ref);
		const inVariableRefs = variableRefs.findIndex(f => f._ref === fontRef._ref);
		if (vfExists === -1 && inVariableRefs === -1 && font.variableFont) variableRefs.push(fontRef);
	} else {
		variableRefs.push(fontRef);
	}
};
