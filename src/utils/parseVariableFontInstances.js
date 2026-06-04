// Resolves named variable font instances into Sanity font document references with multi-pass subfamily-aware matching

import { nanoid } from 'nanoid';
import { expandAbbreviations } from './generateKeywords';

/** Known width prefixes — longest first to match XXNarrow before Narrow */
const WIDTH_PREFIXES = [
	'XXXWide', 'XXWide', 'XWide', 'Wide',
	'XXXNarrow', 'XXNarrow', 'XNarrow', 'Narrow',
];

/**
 * Parses a VF instance name into subfamily (width), weight, and style components.
 * e.g. "XXNarrow Bold Slant" → { subfamily: "XXNarrow", weight: "Bold", style: "Slant" }
 */
function parseInstanceName(instanceName) {
	let subfamily = '';
	let remaining = instanceName.trim();

	for (const prefix of WIDTH_PREFIXES) {
		if (remaining.toLowerCase().startsWith(prefix.toLowerCase() + ' ') || remaining.toLowerCase() === prefix.toLowerCase()) {
			subfamily = prefix;
			remaining = remaining.substring(prefix.length).trim();
			break;
		}
	}

	let style = '';
	for (const suffix of ['Backslant', 'Slant', 'Italic', 'Oblique']) {
		if (remaining.toLowerCase().endsWith(' ' + suffix.toLowerCase()) || remaining.toLowerCase() === suffix.toLowerCase()) {
			style = suffix;
			remaining = remaining.substring(0, remaining.length - suffix.length).trim();
			break;
		}
	}

	return { subfamily, weight: remaining || 'Regular', style };
}

/**
 * Filters static fonts to the same subfamily, preventing cross-subfamily matches.
 */
function filterBySubfamily(staticFonts, instanceSubfamily, typefaceName) {
	if (!instanceSubfamily) {
		return staticFonts.filter(sf => {
			const sub = (sf.subfamily || '').toLowerCase();
			if (sub === '' || sub === 'regular') return true;
			const afterTypeface = (sf.title || '').replace(typefaceName, '').trim();
			return !WIDTH_PREFIXES.some(p => afterTypeface.toLowerCase().startsWith(p.toLowerCase()));
		});
	}
	const lowerSf = instanceSubfamily.toLowerCase();
	const expanded = (expandAbbreviations(instanceSubfamily) || '').toLowerCase();
	return staticFonts.filter(sf => {
		const sub = (sf.subfamily || '').toLowerCase();
		if (sub === lowerSf || (expanded && sub === expanded)) return true;
		const afterTypeface = (sf.title || '').replace(typefaceName, '').trim().toLowerCase();
		if (afterTypeface.startsWith(lowerSf)) return true;
		if (expanded && afterTypeface.startsWith(expanded)) return true;
		return false;
	});
}

/** Weight keyword → numeric weight mapping */
const WEIGHT_MAP = [
	{ term: 'ultra', weight: 950 },
	{ term: 'xxlight', weight: 200 },
	{ term: 'xlight', weight: 250 },
	{ term: 'extralight', weight: 200 },
	{ term: 'extra light', weight: 200 },
	{ term: 'thin', weight: 100 },
	{ term: 'hairline', weight: 100 },
	{ term: 'light', weight: 300 },
	{ term: 'regular', weight: 400 },
	{ term: 'normal', weight: 400 },
	{ term: 'medium', weight: 500 },
	{ term: 'semibold', weight: 600 },
	{ term: 'semi bold', weight: 600 },
	{ term: 'extrabold', weight: 800 },
	{ term: 'extra bold', weight: 800 },
	{ term: 'xbold', weight: 800 },
	{ term: 'bold', weight: 700 },
	{ term: 'black', weight: 900 },
	{ term: 'heavy', weight: 900 },
];

/** Converts a weight name to a numeric weight */
function weightFromName(name) {
	const lower = name.toLowerCase();
	for (const { term, weight } of WEIGHT_MAP) {
		if (lower === term || lower.includes(term)) return weight;
	}
	return 400;
}

/**
 * Multi-pass matching strategies, ordered from most confident to least.
 * Each returns a match function: (instanceName, parsed, candidates, typefaceName, font) => matchedFont|null
 */
const STRATEGIES = [
	// Pass 1: Exact title match (with typeface prefix)
	{
		name: 'exact-title',
		match: (instanceName, parsed, candidates, typefaceName) => {
			const withPrefix = `${typefaceName} ${instanceName}`;
			return candidates.find(sf => sf.title === instanceName || sf.title === withPrefix) || null;
		},
	},
	// Pass 2: Title normalisation — strip typeface name and compare remainder
	{
		name: 'title-normalised',
		match: (instanceName, parsed, candidates, typefaceName) => {
			return candidates.find(sf => {
				const sfName = (sf.title || '').replace(typefaceName, '').trim();
				if (sfName.toLowerCase() === instanceName.toLowerCase()) return true;
				// Handle "Regular" suffix: instance "Narrow Regular" → font title remainder "Narrow"
				if (parsed.weight === 'Regular' && !parsed.style) {
					if (sfName.toLowerCase() === parsed.subfamily.toLowerCase()) return true;
				}
				return false;
			}) || null;
		},
	},
	// Pass 3: Abbreviation expansion (XLight → ExtraLight, XBold → ExtraBold)
	{
		name: 'abbreviation',
		match: (instanceName, parsed, candidates, typefaceName) => {
			const expandedFull = instanceName.split(' ').map(w => expandAbbreviations(w) || w).join(' ');
			let found = candidates.find(sf => {
				const sfName = (sf.title || '').replace(typefaceName, '').trim();
				return sfName.toLowerCase() === expandedFull.toLowerCase();
			});
			if (found) return found;

			// Try expanding just the weight part and rebuilding
			const expandedWeight = expandAbbreviations(parsed.weight) || parsed.weight;
			const target = [parsed.subfamily, expandedWeight, parsed.style].filter(Boolean).join(' ');
			return candidates.find(sf => {
				const sfName = (sf.title || '').replace(typefaceName, '').trim();
				return sfName.toLowerCase() === target.toLowerCase();
			}) || null;
		},
	},
	// Pass 4: fullName metadata comparison
	{
		name: 'metadata-fullName',
		match: (instanceName, parsed, candidates, typefaceName) => {
			return candidates.find(sf => {
				if (!sf.metaData?.fullName) return false;
				const typefacePattern = new RegExp(`^${typefaceName}\\s+`, 'i');
				const stylePart = sf.metaData.fullName.replace(typefacePattern, '').trim();
				return instanceName.toLowerCase() === stylePart.toLowerCase();
			}) || null;
		},
	},
	// Pass 5: Weight + style matching (numeric, within subfamily)
	{
		name: 'weight-style',
		match: (instanceName, parsed, candidates) => {
			const instanceWeight = weightFromName(parsed.weight);
			const isBackslant = parsed.style.toLowerCase() === 'backslant';
			const isSlant = parsed.style.toLowerCase() === 'slant';
			const isItalic = parsed.style.toLowerCase() === 'italic';

			return candidates.find(sf => {
				if (Number(sf.weight) !== instanceWeight) return false;
				if (isBackslant) return sf.style === 'Italic' && sf.title?.toLowerCase().includes('backslant');
				if (isSlant) return sf.style === 'Italic' && !sf.title?.toLowerCase().includes('backslant');
				if (isItalic) return sf.style === 'Italic';
				return sf.style === 'Regular';
			}) || null;
		},
	},
	// Pass 6: weightName string comparison
	{
		name: 'weightName',
		match: (instanceName, parsed, candidates) => {
			const cleanInstance = parsed.weight.toLowerCase().trim();
			return candidates.find(sf => {
				if (!sf.weightName) return false;
				const cleanWeight = sf.weightName.toLowerCase().replace(/italic|slant|backslant/gi, '').trim();
				return cleanInstance === cleanWeight;
			}) || null;
		},
	},
];

/**
 * Multi-pass variable font instance matcher.
 *
 * For each strategy (most confident first):
 *   1. Try to match ALL unmatched instances against ALL unclaimed fonts
 *   2. Collect all matches for this pass
 *   3. Claim matched fonts, remove from both pools
 *   4. Move to next strategy with remaining unmatched
 *
 * This prevents a less-specific match from "stealing" a font that would be
 * the exact match for a different instance processed later.
 */
export const parseVariableFontInstances = async (font, client) => {
	if (!font.variableFont || !font.variableInstances) return [];

	let variableInstances;
	try {
		variableInstances = JSON.parse(font.variableInstances);
	} catch (err) {
		console.error('Error parsing variable instances:', err);
		variableInstances = {};
	}

	if (Object.keys(variableInstances).length === 0) return [];

	// Fetch static fonts
	let staticFonts;
	const typeface = await client.fetch(
		`*[_type == 'typeface' && title == $typefaceName][0]{
			'fonts': styles.fonts[]-> {
				_id, title, subfamily, style, weight, weightName, metaData, variableFont
			}
		}`,
		{ typefaceName: font.typefaceName }
	);

	if (typeface?.fonts && typeface.fonts.length > 0) {
		staticFonts = typeface.fonts.filter(f => !f.variableFont);
		console.log('Using curated typeface fonts list:', staticFonts.length, 'fonts');
	} else {
		console.warn('Typeface not found or no fonts in curated list, falling back to all fonts query');
		staticFonts = await client.fetch(
			`*[_type == 'font' && typefaceName == $typefaceName && variableFont != true]{
				_id, title, subfamily, style, weight, weightName, metaData
			}`,
			{ typefaceName: font.typefaceName }
		);
	}

	const instanceNames = Object.keys(variableInstances);
	console.log('Variable font instances:', instanceNames.length);
	console.log('Available static fonts:', staticFonts.length);

	// Parse all instance names upfront
	const parsedInstances = instanceNames.map(name => ({
		name,
		parsed: parseInstanceName(name),
	}));

	// Track results and claimed fonts
	const results = new Map(); // instanceName → { fontId, strategy }
	const claimedFontIds = new Set();

	// Multi-pass: each strategy gets a full pass over all remaining unmatched instances
	for (const strategy of STRATEGIES) {
		const unmatched = parsedInstances.filter(inst => !results.has(inst.name));
		if (unmatched.length === 0) break;

		// Collect all potential matches for this pass (don't claim yet)
		const passMatches = [];

		for (const inst of unmatched) {
			// Get subfamily-scoped candidates that haven't been claimed
			const subfamilyCandidates = filterBySubfamily(staticFonts, inst.parsed.subfamily, font.typefaceName)
				.filter(sf => !claimedFontIds.has(sf._id));

			const match = strategy.match(inst.name, inst.parsed, subfamilyCandidates, font.typefaceName, font);
			if (match) {
				passMatches.push({ instanceName: inst.name, font: match, strategy: strategy.name });
			}
		}

		// Claim matches — if multiple instances matched the same font, the first one wins
		for (const m of passMatches) {
			if (!claimedFontIds.has(m.font._id) && !results.has(m.instanceName)) {
				results.set(m.instanceName, { fontId: m.font._id, strategy: m.strategy });
				claimedFontIds.add(m.font._id);
			}
		}
	}

	// Build output
	const matched = [...results.values()].length;
	console.log(`[parseVariableFontInstances] Matched ${matched}/${instanceNames.length} instances across ${STRATEGIES.length} passes`);

	const instanceMappings = instanceNames.map(instanceName => {
		const result = results.get(instanceName);
		const matchedFont = result ? staticFonts.find(sf => sf._id === result.fontId) : null;

		console.log(`Instance "${instanceName}" → ${matchedFont ? `${matchedFont.title} (${result.strategy})` : 'No match'}`);

		return {
			key: instanceName,
			value: matchedFont
				? { _type: 'reference', _ref: matchedFont._id, _weak: true }
				: null,
			_key: nanoid(),
		};
	});

	return instanceMappings;
};

export default parseVariableFontInstances;
