// Extracts metadata, metrics, glyph count, OpenType features, and variable axes from a font and optionally patches the Sanity font document

import { parseFont } from './parseFont';
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
	if (!fontKit || fontKit == null) {
		let buffer = await fetch(srcUrl);
		buffer = await buffer.arrayBuffer();
		font = await parseFont(buffer, `${fontId}.ttf`);
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

	let patch = {
		metrics: metrics,
		metaData: metaData,
		variableFont: variableFont,
		variableAxes: JSON.stringify(variableAxes),
		variableInstances: JSON.stringify(variableInstances),
		glyphCount: glyphCount,
		opentypeFeatures: { chars: opentypeFeatures },
		characterSet: { chars: characterSet },
	};

	console.log('Font data patch:', Object.keys(patch));
	if (commit) patch = await client.patch(fontId).set(patch).commit({ autoGenerateArrayKeys: true });
	return patch;
}
