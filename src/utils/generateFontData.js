// Extracts metadata, metrics, glyph count, OpenType features, and variable axes from a font and optionally patches the Sanity font document

import { parseFont } from './parseFont';
import { computeCedarsProfile } from './computeCedarsProfile';
import {
	getFontMetadata,
	getFontMetrics,
	getVariationAxes,
	getNamedInstances,
	getAllFeatureTags,
	getGlyphCount,
	getCharacterSet,
	getNameString,
} from './fontHelpers';

/**
 * Extracts metadata and metrics from a lib-font parsed font into plain objects.
 * Uses fontHelpers for all table access — no direct font.opentype.tables usage here.
 * @param {object} font - lib-font Font instance
 * @returns {{ metaData: Object, metrics: Object }}
 */
export function buildFontMetadata(font) {
	const metaData = getFontMetadata(font);
	// Strip "Version " prefix for consistency with existing Sanity documents
	if (metaData.version) {
		metaData.version = String(metaData.version).replaceAll('Version ', '');
	}
	const metrics = getFontMetrics(font);
	return { metaData, metrics };
}

export default async function generateFontData({ fileInput, url, fontKit, fontId, client, commit = true }) {
	if (fontId.startsWith('drafts.')) {
		fontId = fontId.replace('drafts.', '');
	}
	console.log('Generate font data:', fontId, commit);

	let srcUrl;
	if (!url || url == null) {
		srcUrl = await client.fetch(`*[_id == $id]{url}`, { id: fileInput.ttf.asset._ref });
		srcUrl = srcUrl[0].url;
	} else {
		srcUrl = url;
	}

	let font = fontKit;
	// Hoisted so the CEDARS+ step below can reuse the raw bytes when we fetched them.
	let fontBuffer = null;
	if (!fontKit || fontKit == null) {
		const res = await fetch(srcUrl);
		fontBuffer = await res.arrayBuffer();
		font = await parseFont(fontBuffer, `${fontId}.ttf`);
	}

	const variableAxes = getVariationAxes(font);
	const namedInstances = getNamedInstances(font);

	// Build variableInstances as a keyed object matching existing Sanity document shape
	let variableInstances = null;
	if (namedInstances.length > 0 && variableAxes) {
		variableInstances = {};
		const axisTags = Object.keys(variableAxes);
		for (const inst of namedInstances) {
			const key = inst.name || inst.postScriptName || 'Unknown';
			const coord = {};
			axisTags.forEach((tag, index) => {
				coord[tag] = inst.coordinates[index];
			});
			variableInstances[key] = coord;
		}
	}

	console.log('Variable instances:', variableInstances);
	console.log('Variable axes:', variableAxes);

	const opentypeFeatures = getAllFeatureTags(font);
	const glyphCount = getGlyphCount(font);
	const characterSet = getCharacterSet(font);

	const { metaData, metrics } = buildFontMetadata(font);

	let variableFont = false;
	if (variableAxes && variableInstances && Object.keys(variableInstances).length > 0) {
		variableFont = true;
	}

	// CEDARS+ profile — best-effort enrichment. Wrapped so a failure here can never
	// block the font upload; the raw bytes are fetched only if we don't already have them.
	let cedarsPlus = null;
	try {
		if (!fontBuffer) {
			const res = await fetch(srcUrl);
			fontBuffer = await res.arrayBuffer();
		}
		cedarsPlus = computeCedarsProfile(fontBuffer);
	} catch (err) {
		console.warn('CEDARS profile computation failed:', err?.message || err);
	}

	let patch = {
		metrics: metrics,
		metaData: metaData,
		variableFont: variableFont,
		variableAxes: JSON.stringify(variableAxes),
		variableInstances: JSON.stringify(variableInstances),
		glyphCount: glyphCount,
		opentypeFeatures: { chars: opentypeFeatures },
		characterSet: { chars: characterSet },
		...(cedarsPlus ? { cedarsPlus } : {}),
	};

	console.log('Font data patch:', Object.keys(patch));
	if (commit) patch = await client.patch(fontId).set(patch).commit({ autoGenerateArrayKeys: true });
	return patch;
}
