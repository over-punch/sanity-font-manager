// Builds a @font-face CSS file from a WOFF2 blob — URL or base64 src, variable font axis descriptors, metric-tuned fallback @font-face for CLS reduction

import base64 from 'base-64';
import { parseFont } from './parseFont';
import { getVariationAxes, getFontMetrics, getFamilyClass, escapeCssFontName } from './fontHelpers';

function _arrayBufferToBase64(buffer) {
	var binary = '';
	var bytes = new Uint8Array(buffer);
	var len = bytes.byteLength;
	for (var i = 0; i < len; i++) {
		binary += String.fromCharCode(bytes[i]);
	}
	return base64.encode(binary);
}

/**
 * Builds CSS @font-face axis descriptors from a variation axis map.
 * Accepts a pre-built axis map (from getVariationAxes) rather than a raw font object,
 * so callers can share a single parse result.
 *
 * @param {object|null} axisMap - Keyed axis map { wght: { min, max, default }, ... } or null
 * @returns {{ descriptors: string, skipped: string[] }}
 */
export function buildVFDescriptors(axisMap) {
	const cssAxes = {};
	const skipped = [];

	if (!axisMap) return { descriptors: '', skipped: [] };

	try {
		for (const [tag, axis] of Object.entries(axisMap)) {
			const lo = Math.min(axis.min, axis.max);
			const hi = Math.max(axis.min, axis.max);

			// Skip degenerate axes — no actual range
			if (lo === hi) { skipped.push(tag); continue; }

			if (tag === 'wght') {
				cssAxes['font-weight'] = `${lo} ${hi}`;
			} else if (tag === 'wdth') {
				// Clamp to CSS font-stretch range (50-200%)
				cssAxes['font-stretch'] = `${Math.max(50, lo)}% ${Math.min(200, hi)}%`;
			} else if (tag === 'slnt') {
				// OpenType slnt is counter-clockwise positive; CSS oblique is clockwise positive
				// Negate values and ensure ascending order
				cssAxes['font-style'] = `oblique ${-hi}deg ${-lo}deg`;
			} else if (tag === 'ital' && !cssAxes['font-style']) {
				// ital: only note if font has italic range; slnt takes priority
				if (hi > 0) cssAxes['font-style'] = 'italic';
				else skipped.push(tag);
			} else {
				// opsz, GRAD, XTRA, XHGT and all other custom axes have no CSS @font-face descriptor
				skipped.push(tag);
			}
		}
	} catch (_) {
		// axes unreadable — no descriptors
	}

	const descriptors = Object.entries(cssAxes).map(([k, v]) => `${k}:${v}`).join(';') + (Object.keys(cssAxes).length ? ';' : '');
	return { descriptors, skipped };
}

// Cross-platform fallback font stacks by category.
const FALLBACK_STACKS = {
	'sans-serif': "local('Arial'), local('Helvetica Neue'), local('Roboto'), local('Liberation Sans')",
	'serif':      "local('Georgia'), local('Times New Roman'), local('Times')",
	'monospace':  "local('Courier New'), local('Courier'), local('Menlo'), local('Monaco')",
	'default':    "local('Arial'), local('Helvetica Neue'), local('Roboto'), local('Liberation Sans')",
};

// OS/2 sFamilyClass high byte → FALLBACK_STACKS key.
const FAMILY_CLASS_MAP = {
	1: 'serif', 2: 'serif', 3: 'serif', 4: 'serif', 5: 'serif', 7: 'serif',
	8: 'sans-serif',
};

// Darden Studio fonts have sFamilyClass: 0 in their OS/2 table,
// so name-based matching is used as the primary signal.
const SERIF_NAMES  = /jubilat|corundum|dapifer|birra|daith/i;
const SANS_NAMES   = /halyard|gamay|omnes|kit/i;

/**
 * Detects font category from the font name first, then OS/2 sFamilyClass as fallback.
 * @param {object} font - lib-font Font instance
 * @param {string} fontName
 * @returns {string}
 */
function detectFontCategory(font, fontName) {
	if (fontName && SERIF_NAMES.test(fontName)) return 'serif';
	if (fontName && SANS_NAMES.test(fontName)) return 'sans-serif';
	try {
		const familyClass = getFamilyClass(font);
		const highByte = (familyClass >> 8) & 0xFF;
		return FAMILY_CLASS_MAP[highByte] ?? 'default';
	} catch {
		return 'default';
	}
}

/**
 * Extracts metric override percentages and detects the category fallback stack.
 * Accepts a pre-parsed font to avoid double-parsing.
 * @param {object} font - lib-font Font instance
 * @param {string} fontName
 * @returns {{ fallbackSrc: string, ascentOverride: string, descentOverride: string, lineGapOverride: string }}
 */
function calcFallbackData(font, fontName) {
	try {
		const metrics = getFontMetrics(font);
		const upm = metrics.unitsPerEm;
		const category = detectFontCategory(font, fontName);
		return {
			fallbackSrc: FALLBACK_STACKS[category],
			ascentOverride: `${(metrics.ascender / upm * 100).toFixed(2)}%`,
			descentOverride: `${(Math.abs(metrics.descender) / upm * 100).toFixed(2)}%`,
			lineGapOverride: `${(metrics.lineGap / upm * 100).toFixed(2)}%`,
		};
	} catch (err) {
		console.error('Failed to extract fallback font data:', err);
		return {
			fallbackSrc: FALLBACK_STACKS['default'],
			ascentOverride: '100%',
			descentOverride: '0%',
			lineGapOverride: '0%',
		};
	}
}

export default async function generateCssFile({
	woff2File,
	fileInput,
	language = null,
	fileName,
	fontName,
	variableFont,
	weight,
	style = 'Normal',
	client,
}) {
	try {
		// Read the file once; reuse the same buffer for base64 and font analysis
		let arrayBuffer = await woff2File.arrayBuffer();
		let b64 = _arrayBufferToBase64(arrayBuffer);

		// Parse once — share result between axis descriptors and fallback metrics
		let font = await parseFont(arrayBuffer, fileName + '.woff2');
		let { fallbackSrc, ascentOverride, descentOverride, lineGapOverride } = calcFallbackData(font, fontName);

		// Escape font name for CSS injection prevention
		const safeFontName = escapeCssFontName(fontName);

		let cssString;
		if (variableFont) {
			const axisMap = getVariationAxes(font);
			let { descriptors, skipped } = buildVFDescriptors(axisMap);
			let skipComment = skipped.length
				? `/* axes present but have no @font-face descriptor: ${skipped.join(', ')}` +
				  (skipped.includes('opsz') ? ' — add font-optical-sizing:auto to your element CSS' : '') +
				  ' */'
				: '';
			cssString = `${skipComment}@font-face{font-family:'${safeFontName}';src:url(data:application/font-woff2;charset=utf-8;base64,${b64})format('woff2');${descriptors}font-display:swap;}`;
		} else {
			let fontStyle = style === 'Italic' ? 'italic' : 'normal';
			cssString = `@font-face{font-family:'${safeFontName}';src:url(data:application/font-woff2;charset=utf-8;base64,${b64})format('woff2');font-weight:${weight};font-style:${fontStyle};font-display:swap;}`;
		}

		// Fallback @font-face: tunes a system font to match the custom font's metrics for CLS reduction
		let fallbackCssString = `@font-face{font-family:'${safeFontName} Fallback';src:${fallbackSrc};ascent-override:${ascentOverride};descent-override:${descentOverride};line-gap-override:${lineGapOverride};}`;

		// Upload as a text buffer (no Buffer polyfill needed — TextEncoder is native)
		const cssBytes = new TextEncoder().encode(cssString + fallbackCssString);
		let doc = await client.assets.upload('file', new Blob([cssBytes]), { filename: fileName + '.css' });

		let newFileInput = language == null ?
			{
				...fileInput,
				css: {
					_type: 'file',
					asset: {
						_type: 'reference',
						_ref: doc._id,
					},
				},
			}
			:
			{
				...fileInput,
				[language]: {
					...fileInput[language],
					css: {
						_type: 'file',
						asset: {
							_type: 'reference',
							_ref: doc._id,
						},
					},
				},
			};

		return newFileInput;
	} catch (err) {
		console.error(err);
		throw err;
	}
}
