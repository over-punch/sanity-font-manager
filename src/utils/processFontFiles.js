// Reads font files via FileReader, parses with lib-font, and builds the fontsObjects map — exports individual weight/style extraction helpers

import { parseFont } from './parseFont';
import { getNameString, getVariationAxes, getItalicAngle, getWeightClass } from './fontHelpers';
import { nanoid } from 'nanoid';
import { expandAbbreviations, removeWeightNames, reverseSpellingLookup } from './generateKeywords';
import { sanitizeForSanityId } from './sanitizeForSanityId';

/**
 * Reads a font file and returns its content as an ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export const readFontFile = (file) => {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = (event) => { resolve(event.target.result); };
		reader.onerror = (error) => { reject(error); };
		reader.readAsArrayBuffer(file);
	});
};

/**
 * Processes an array of font files and extracts metadata for each.
 * @param {File[]} files
 * @param {string} title - Typeface title
 * @param {string[]} weightKeywordList
 * @param {string[]} italicKeywordList
 * @param {Function} setStatus
 * @param {boolean} preserveShortenedNames - Skip abbreviation expansion when true
 * @param {boolean} preserveFileNames - Preserve original filename capitalization when true
 * @returns {Promise<Object>}
 */
export const processFontFiles = async (
	files,
	title,
	weightKeywordList,
	italicKeywordList,
	setStatus,
	preserveShortenedNames = false,
	preserveFileNames = false,
) => {
	let failedFiles = [];
	let subfamilies = {};
	let fontsObjects = {};
	let newPreferredStyle = { weight: -100, style: 'Italic', _ref: '' };

	for (let i = 0; i < files.length; i++) {
		const file = files[i];
		const fontBuffer = await readFontFile(file);
		const font = await parseFont(fontBuffer, file.name);

		console.log('File name:', file.name);

		// For webfonts with missing metadata, try to extract from TTF companion
		const ttfFallbackMeta = await getWebfontFallbackMetadata(file, font, files);

		let { weightName, subfamilyName, fontTitle, style, italicKW, variableFont } = extractFontMetadata(
			font,
			title,
			weightKeywordList,
			italicKeywordList,
			preserveShortenedNames,
			ttfFallbackMeta,
		);

		let id;
		let originalFilename = null;

		if (preserveFileNames) {
			originalFilename = file.name.replace(/\.(ttf|otf|woff2?|eot|svg)$/i, '');
			// Normalize filename: hyphens to spaces, split camelCase boundaries, collapse whitespace
			const normalizedName = originalFilename
				.replace(/-/g, ' ')
				.replace(/([a-z])([A-Z])/g, '$1 $2')
				.replace(/\s+/g, ' ')
				.trim();
			fontTitle = normalizedName;
			id = sanitizeForSanityId(normalizedName);
		} else {
			id = sanitizeForSanityId(fontTitle);
		}

		logFontInfo(id, fontTitle, font, file.name, subfamilyName, style, weightName, variableFont, italicKW);

		subfamilies[id] = subfamilyName;

		if (fontsObjects[id]) {
			fontsObjects[id].files = [...fontsObjects[id].files, file];
			if (preserveFileNames && originalFilename) {
				fontsObjects[id].originalFilename = originalFilename;
			}
		} else {
			fontsObjects[id] = createFontObject(
				id,
				fontTitle,
				title,
				font,
				variableFont,
				weightName,
				subfamilyName,
				file,
				preserveFileNames ? originalFilename : null,
			);
		}
	}

	fontsObjects = sortFontObjects(fontsObjects);
	const uniqueSubfamilies = [...new Set(Object.values(subfamilies))];

	console.log('Subfamilies:', subfamilies);
	console.log('Unique subfamilies:', uniqueSubfamilies, uniqueSubfamilies.length);
	console.log('Font objects:', Object.keys(fontsObjects));

	return { fontsObjects, subfamilies, uniqueSubfamilies, newPreferredStyle, failedFiles };
};

/**
 * Gets fallback metadata from a matching TTF when woff/woff2 metadata is missing.
 * Returns null if no fallback is needed or no TTF companion exists.
 * Unlike the old fontkit approach, this does NOT mutate the font object.
 * @param {File} file
 * @param {object} font - lib-font parsed font
 * @param {File[]} files
 * @returns {Promise<{ fullName: string, familyName: string, subfamilyName: string, preferredSubfamily: string }|null>}
 */
const getWebfontFallbackMetadata = async (file, font, files) => {
	if (!file.name.endsWith('.woff2') && !file.name.endsWith('.woff')) return null;

	const fullName = getNameString(font, 4);
	// Check if name table is missing or corrupt (empty, or only uppercase hex-like garbage)
	if (fullName && fullName !== '' && !/^[A-Z0-9]+$/.test(fullName)) return null;

	const ttfFile = files.find(f => f.name === file.name.replace('.woff2', '.ttf').replace('.woff', '.ttf'));
	if (!ttfFile) return null;

	try {
		const ttfBuffer = await readFontFile(ttfFile);
		const ttfFont = await parseFont(ttfBuffer, ttfFile.name);
		return {
			fullName: getNameString(ttfFont, 4),
			familyName: getNameString(ttfFont, 1),
			subfamilyName: getNameString(ttfFont, 2),
			preferredSubfamily: getNameString(ttfFont, 17),
			preferredFamily: getNameString(ttfFont, 16),
		};
	} catch (err) {
		console.warn('Could not parse TTF companion for webfont fallback:', err.message);
		return null;
	}
};

/**
 * Extracts and normalises metadata from a lib-font parsed font object.
 * @param {object} font - lib-font parsed font
 * @param {string} title - Typeface title
 * @param {string[]} weightKeywordList
 * @param {string[]} italicKeywordList
 * @param {boolean} preserveShortenedNames
 * @param {object|null} ttfFallbackMeta - Fallback metadata from TTF companion (for webfonts with missing names)
 * @returns {Object}
 */
export const extractFontMetadata = (font, title, weightKeywordList, italicKeywordList, preserveShortenedNames = false, ttfFallbackMeta = null) => {
	let weightName = extractWeightName(font, italicKeywordList, ttfFallbackMeta);
	if (!preserveShortenedNames) {
		weightName = expandAbbreviations(weightName);
	}

	const fullName = getNameString(font, 4) || ttfFallbackMeta?.fullName || '';

	if ((weightName === '' || weightName.toLowerCase() === 'roman') && fullName) {
		weightName = extractWeightFromFullName(font, title, ttfFallbackMeta);
		if (!preserveShortenedNames) {
			weightName = expandAbbreviations(weightName);
		}
	}

	const axes = getVariationAxes(font);
	const variableFont = axes !== null;

	// Subfamily detection — extract width/optical variant from name table.
	// Primary: nameId4 (fullName) minus typeface title — the most complete name record,
	// always contains width + weight (e.g. "Gear XXNarrow Regular" → "XXNarrow Regular").
	// Fallback: nameId1 (familyName) minus typeface title — contains width but not always weight.
	// processSubfamilyName then strips weight/italic keywords, leaving just the width variant.
	// This matches the production logic that has been reliable across all foundry sites.
	const trimmedTitle = title.trim();

	const nameId4Remainder = fullName ? fullName.replace(trimmedTitle, '').trim() : '';
	const nameId1 = getNameString(font, 1) || ttfFallbackMeta?.familyName || '';
	const nameId1Remainder = nameId1 ? nameId1.replace(trimmedTitle, '').trim() : '';

	let subfamilyName = nameId4Remainder || nameId1Remainder;

	if (!preserveShortenedNames) {
		subfamilyName = expandAbbreviations(subfamilyName);
	}

	let fontTitle = fullName.trim() || '';
	const italicAngle = getItalicAngle(font);
	let style = (italicAngle !== 0 || fullName.toLowerCase().includes('italic')) ? 'Italic' : 'Regular';

	const italicKW = processItalicKeywords(font, fontTitle, italicKeywordList);

	subfamilyName = processSubfamilyName(subfamilyName, weightKeywordList, italicKW, preserveShortenedNames);
	fontTitle = formatFontTitle(fontTitle, preserveShortenedNames);

	// Style-only names are not subfamilies — strip them
	subfamilyName = subfamilyName
		.replace(/\b(Italic|Slant|Slanted|Oblique|Backslant|Roman|Upright)\b/gi, '')
		.replace(/\s+/g, ' ')
		.trim();

	if (subfamilyName !== '') {
		weightName = weightName
			.replace(`${subfamilyName} `, '')
			.replace(` ${subfamilyName}`, '')
			.trim();
	}

	if (variableFont) {
		if (!fontTitle.toLowerCase().includes('vf')) {
			fontTitle = fontTitle + ' VF';
		}
		// Variable fonts are not placed in subfamilies — they go in the separate variableFont array
		subfamilyName = '';
	}

	if (!(variableFont && fontTitle.toLowerCase().includes('italic'))) {
		fontTitle = addItalicToFontTitle(font, fontTitle, italicKW, style, preserveShortenedNames);
	}

	return { weightName, subfamilyName, fontTitle, style, italicKW, variableFont };
};

/**
 * Extracts the weight name from a font's preferred subfamily or subfamily record.
 * Returns "Variable" for variable fonts.
 * @param {object} font - lib-font parsed font
 * @param {string[]} italicKW
 * @param {object|null} ttfFallbackMeta
 * @returns {string}
 */
export const extractWeightName = (font, italicKW, ttfFallbackMeta = null) => {
	let weightName = getNameString(font, 17) || getNameString(font, 2) ||
		ttfFallbackMeta?.preferredSubfamily || ttfFallbackMeta?.subfamilyName || '';

	const axes = getVariationAxes(font);
	if (axes !== null) {
		return '';
	}

	if (italicKW) {
		italicKW.forEach(keyword => {
			const kwRegex = new RegExp(`\\b${keyword.trim()}\\b`, 'i');
			if (kwRegex.test(weightName)) {
				weightName = weightName.replace(kwRegex, '').trim();
			}
		});
	}

	return weightName?.toString()
		.replace('Italic', '')
		.replace('It', '')
		.replace('Slanted', '')
		.replace('Slant', '')
		.replace('Backslant', '')
		.trim();
};

/**
 * Extracts a weight name from the font's full name record when subfamily is empty or "Roman".
 * @param {object} font - lib-font parsed font
 * @param {string} title
 * @param {object|null} ttfFallbackMeta
 * @returns {string}
 */
export const extractWeightFromFullName = (font, title, ttfFallbackMeta = null) => {
	let weightName = getNameString(font, 4) || ttfFallbackMeta?.fullName || '';
	weightName = weightName.replace(title + ' ', '').replace(title, '').trim();
	weightName = weightName.replace('Italic', '').replace('It', '').replace('Slanted', '').replace('Slant', '').trim();
	return weightName;
};

/**
 * Strips weight and italic keywords from a subfamily name string.
 * @param {string} subfamilyName
 * @param {string[]} weightKeywordList
 * @param {string[]} italicKeywordList
 * @param {boolean} preserveShortenedNames
 * @returns {string}
 */
export const processSubfamilyName = (subfamilyName, weightKeywordList, italicKeywordList, preserveShortenedNames = false) => {
	weightKeywordList.forEach(keyword => {
		const kwRegex = new RegExp(`\\b${keyword.trim()}\\b`, 'i');
		if (kwRegex.test(subfamilyName)) {
			subfamilyName = subfamilyName.replace(kwRegex, '').trim();
		}
		subfamilyName = removeWeightNames(subfamilyName) || subfamilyName;
		if (!preserveShortenedNames) {
			subfamilyName = expandAbbreviations(subfamilyName);
		}
	});

	italicKeywordList.forEach(keyword => {
		const kwRegex = new RegExp(`\\b${keyword.trim()}\\b`, 'i');
		if (kwRegex.test(subfamilyName)) {
			subfamilyName = subfamilyName.replace(kwRegex, '').trim();
		}
	});

	return subfamilyName;
};

/**
 * Collects italic keywords present in a font's full name.
 * @param {object} font - lib-font parsed font
 * @param {string} fontTitle
 * @param {string[]} italicKeywordList
 * @returns {string[]}
 */
export const processItalicKeywords = (font, fontTitle, italicKeywordList) => {
	let italicKW = [];
	const fullName = getNameString(font, 4);

	italicKeywordList.forEach(keyword => {
		const kw = keyword.trim();
		const kwRegex = new RegExp(`\\b${kw}\\b`, 'i');
		if (kwRegex.test(fontTitle)) {
			fontTitle = fontTitle.replace(kwRegex, '').trim();
			italicKW.push(kw);
		}
		if (fullName && fullName.toLowerCase().includes(kw.toLowerCase())) {
			if (!italicKW.includes(kw)) italicKW.push(kw);
		}
	});

	return italicKW;
};

/**
 * Normalises and title-cases a font title, optionally expanding abbreviations.
 * @param {string} fontTitle
 * @param {boolean} preserveShortenedNames
 * @returns {string}
 */
export const formatFontTitle = (fontTitle, preserveShortenedNames = false) => {
	const hasItalic = fontTitle.toLowerCase().includes('italic');
	fontTitle = fontTitle.replace(/-/g, ' ');

	return fontTitle.replace(/\s+/g, ' ').trim().split(' ').map(word => {
		if (hasItalic && word.toLowerCase() === 'italic') return 'Italic';
		let fullWord = word;
		if (!preserveShortenedNames) {
			fullWord = reverseSpellingLookup(word) || word;
		}
		return fullWord[0].toUpperCase() + fullWord.slice(1);
	}).join(' ');
};

/**
 * Appends any italic keywords to the font title that aren't already present.
 * @param {object} font - lib-font parsed font
 * @param {string} fontTitle
 * @param {string[]} italicKW
 * @param {string} style
 * @param {boolean} preserveShortenedNames
 * @returns {string}
 */
export const addItalicToFontTitle = (font, fontTitle, italicKW, style, preserveShortenedNames = false) => {
	const hasItalicAngle = getItalicAngle(font) !== 0;
	const fullName = getNameString(font, 4);
	const hasItalicInName = fullName.toLowerCase().includes('italic');

	if (italicKW.length > 0 || hasItalicAngle || hasItalicInName) {
		italicKW = [...new Set(italicKW)];

		if (italicKW.length === 0 && (hasItalicAngle || hasItalicInName)) {
			italicKW = ['Italic'];
		}

		if (!preserveShortenedNames) {
			italicKW = italicKW.map(item => reverseSpellingLookup(item) || item);
		}

		italicKW = [...new Set(italicKW)];

		if (italicKW.length > 1 && italicKW.includes('Italic')) {
			italicKW = ['Italic'];
		}

		const fontTitleLower = fontTitle.toLowerCase();
		italicKW = italicKW.filter(keyword => {
			const keywordLower = keyword.toLowerCase();
			const kwRegex = new RegExp(`\\b${keywordLower}\\b`);
			const isSubstring = fontTitleLower.split(' ').some(word =>
				word.includes(keywordLower) || keywordLower.includes(word)
			);
			return !kwRegex.test(fontTitleLower) && !isSubstring;
		});

		if (italicKW.length > 0) {
			fontTitle = fontTitle.trim() + ' ' + italicKW.join(' ');
		}
	}

	return fontTitle;
};

/**
 * Builds a font object ready for staging and upload.
 * originalFilename is stored temporarily and deleted before saving to Sanity.
 * @param {string} id
 * @param {string} fontTitle
 * @param {string} title
 * @param {object} font - lib-font parsed font
 * @param {boolean} variableFont
 * @param {string} weightName
 * @param {string} subfamilyName
 * @param {File} file
 * @param {string|null} originalFilename
 * @returns {Object}
 */
export const createFontObject = (id, fontTitle, title, font, variableFont, weightName, subfamilyName, file, originalFilename = null) => {
	const italicAngle = getItalicAngle(font);
	const fullName = getNameString(font, 4);

	const fontObject = {
		_key: nanoid(),
		_id: id,
		title: fontTitle,
		slug: { _type: 'slug', current: id },
		typefaceName: title,
		style: (italicAngle !== 0 || fullName.toLowerCase().includes('italic')) ? 'Italic' : 'Regular',
		variableFont: variableFont,
		weightName: weightName,
		subfamily: subfamilyName,
		normalWeight: true,
		weight: Number(determineWeight(font, weightName)),
		fileInput: {},
		files: [file],
		fontKit: font,
	};

	if (originalFilename) {
		fontObject.originalFilename = originalFilename;
	}

	return fontObject;
};

/**
 * Determines a numeric CSS weight value for a font.
 * @param {object} font - lib-font parsed font
 * @param {string} weightName
 * @returns {number}
 */
export const determineWeight = (font, weightName) => {
	const usWeightClass = getWeightClass(font);
	if (usWeightClass) {
		return Number(usWeightClass);
	}

	const wn = weightName?.toLowerCase() || '';

	if (/hairline|extra thin|extrathin/.test(wn)) return 100;
	if (/thin|extra light|extralight/.test(wn)) return 200;
	if (/light|book/.test(wn)) return 300;
	if (/regular|normal/.test(wn)) return 400;
	if (/medium/.test(wn)) return 500;
	if (/semi bold|semibold/.test(wn)) return 600;
	if (/extra bold|extrabold/.test(wn)) return 800;
	if (/bold/.test(wn)) return 700;
	if (/black|ultra/.test(wn)) return 900;

	return 400;
};

/**
 * Sorts a map of font objects by ascending weight, with Regular before Italic at equal weights.
 * @param {Object} fontsObjects
 * @returns {Object}
 */
export const sortFontObjects = (fontsObjects) => {
	return Object.fromEntries(
		Object.entries(fontsObjects).sort((a, b) => {
			const weightA = Number(a[1].weight);
			const weightB = Number(b[1].weight);
			if (weightA === weightB) {
				if (a[1].style === 'Regular' && b[1].style === 'Italic') return -1;
				if (a[1].style === 'Italic' && b[1].style === 'Regular') return 1;
				return 0;
			}
			return weightA - weightB;
		})
	);
};

/**
 * Logs font metadata to the console for debugging.
 * @param {string} id
 * @param {string} fontTitle
 * @param {object} font - lib-font parsed font
 * @param {string} fileName
 * @param {string} subfamilyName
 * @param {string} style
 * @param {string} weightName
 * @param {boolean} variableFont
 * @param {string[]} italicKW
 */
export const logFontInfo = (id, fontTitle, font, fileName, subfamilyName, style, weightName, variableFont, italicKW) => {
	const fullName = getNameString(font, 4);
	const familyName = getNameString(font, 1);
	const italicAngle = getItalicAngle(font);

	console.log('=== Font Info ====');
	console.log('Font id:', id);
	console.log('Font title:', fontTitle);
	console.log('Full name:', fullName);
	console.log('Family name:', familyName);
	console.log('File name:', fileName);
	console.log('Subfamily:', subfamilyName);
	console.log('Style:', style);
	console.log('Weight:', weightName);
	console.log('Variable:', variableFont);
	console.log('ItalicKW:', italicKW);
	console.log('Italic detection:', (italicAngle !== 0 || fullName.toLowerCase().includes('italic')) ? 'Italic' : 'Regular');
	console.log('=======');
};
