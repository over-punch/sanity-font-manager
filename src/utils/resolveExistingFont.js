// Standalone document resolution — determines if a font already exists in Sanity

import { RECOMMENDATION } from './planTypes';

/**
 * Resolves whether a font document already exists in Sanity, returning match details
 * and a recommendation for how to proceed.
 *
 * Resolution strategies (in priority order):
 *   1. Exact _id match or draft _id match or slug.current match
 *   2. Content match by typefaceName + weightName + style + subfamily + variableFont
 *
 * @param {object} font - { _id, typefaceName, weightName, style, subfamily, variableFont, title }
 * @param {object} client - Sanity client (parameterized queries only)
 * @returns {Promise<{ exact: object|null, candidates: object[], recommendation: string, lookupFailed: boolean }>}
 */
export const resolveExistingFont = async (font, client) => {
	const result = {
		exact: null,
		candidates: [],
		recommendation: RECOMMENDATION.CREATE,
		lookupFailed: false,
	};

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
			result.recommendation = RECOMMENDATION.USE_EXACT;
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
			result.recommendation = RECOMMENDATION.USE_CANDIDATE;
			return result;
		}

		if (contentMatches.length > 1) {
			result.candidates = contentMatches;
			result.recommendation = RECOMMENDATION.AMBIGUOUS;
			console.warn(`Ambiguous font match for "${font.title}" — ${contentMatches.length} candidates found:`,
				contentMatches.map(c => c._id));
			return result;
		}
	} catch (err) {
		console.error('Error resolving existing font:', font._id, err.message);
		result.lookupFailed = true;
	}

	return result;
};
