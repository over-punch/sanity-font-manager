// Canonical map of openType field keys to their display title and the OpenType layout tags each feature requires

/**
 * Every feature key defined in `openTypeField`, paired with its display title and the OpenType
 * layout feature tags a font must expose for that feature to count as supported.
 *
 * Space-separated tags mean ALL of them are required — `proportionalOldstyle` needs both `pnum`
 * and `onum`, `allStylisticSets` needs the full `ss01`–`ss20` run.
 *
 * This lives in its own dependency-free module so `SetOTF` can read it without importing
 * `openTypeField.js` (which imports `SetOTF` — a cycle that would break the Studio's Vite bundle,
 * the same failure class as the `lib-font` import-order bug fixed in 2.11.2).
 *
 * `src/tests/openTypeFeatureTags.test.js` guards this against drift from the schema definition.
 */
export const OPENTYPE_FEATURE_TAGS = {
	allAlternates: { title: 'All Alternates', feature: 'aalt' },
	allCaps: { title: 'All Caps', feature: 'case cpsp' },
	alternateAnnotation: { title: 'Alternate Annotation', feature: 'nalt' },
	alternativeFractions: { title: 'Alternative Fractions', feature: 'afrc' },
	capitalsToSmallCaps: { title: 'Capitals to Small Caps', feature: 'c2sc' },
	capitalsToPetiteCaps: { title: 'Capitals to Petite Caps', feature: 'c2pc' },
	caseSensitiveForms: { title: 'Case Sensitive Forms', feature: 'case' },
	contextualAlternates: { title: 'Contextual Alternates', feature: 'calt' },
	contextualLigatures: { title: 'Contextual Ligatures', feature: 'clig' },
	contextualSwash: { title: 'Contextual Swash', feature: 'cswh' },
	denominator: { title: 'Denominator', feature: 'dnom' },
	discretionaryLigatures: { title: 'Discretionary Ligatures', feature: 'dlig' },
	fractions: { title: 'Fractions', feature: 'frac' },
	glyphDecomposition: { title: 'Glyph Decomposition', feature: 'ccmp' },
	historicalForms: { title: 'Historical Forms', feature: 'hist' },
	historicalLigatures: { title: 'Historical Ligatures', feature: 'hlig' },
	initialForm: { title: 'Initial Form', feature: 'init' },
	isolatedForm: { title: 'Isolated Form', feature: 'isol' },
	justifiedAlternates: { title: 'Justification Alternates', feature: 'jalt' },
	localizedForms: { title: 'Localized Forms', feature: 'locl' },
	markPositioning: { title: 'Mark Positioning', feature: 'mark' },
	markPositioningViaSubs: { title: 'Mark Positioning via Subs', feature: 'mset' },
	markToMarkPositioning: { title: 'Mark to Mark Positioning', feature: 'mkmk' },
	mathematicalGreek: { title: 'Mathematical Greek', feature: 'mgrk' },
	medialForm: { title: 'Medial Form', feature: 'medi' },
	numerator: { title: 'Numerator', feature: 'numr' },
	ordinals: { title: 'Ordinals', feature: 'ordn' },
	ornaments: { title: 'Ornaments', feature: 'ornm' },
	petiteCaps: { title: 'Petite Caps', feature: 'pcap' },
	proportionalLining: { title: 'Proportional Lining', feature: 'pnum lnum' },
	proportionalOldstyle: { title: 'Proportional Oldstyle', feature: 'pnum onum' },
	requiredLigatures: { title: 'Required Ligatures', feature: 'rlig' },
	scientificInferiors: { title: 'Scientific Inferiors', feature: 'sinf' },
	slashedZero: { title: 'Slashed Zero', feature: 'zero' },
	smallCaps: { title: 'Small Caps', feature: 'smcp' },
	standardLigatures: { title: 'Standard Ligatures', feature: 'liga' },
	stylisticAlternates: { title: 'Stylistic Alternates', feature: 'salt' },
	subscript: { title: 'Subscript', feature: 'subs' },
	superscript: { title: 'Superscript', feature: 'sups' },
	swash: { title: 'Swash', feature: 'swsh' },
	tabularLining: { title: 'Tabular Lining', feature: 'tnum lnum' },
	tabularOldstyle: { title: 'Tabular Oldstyle', feature: 'tnum onum' },
	terminalForm: { title: 'Terminal Form', feature: 'fina' },
	titlingAlternates: { title: 'Titling Alternates', feature: 'titl' },
	unicase: { title: 'Unicase', feature: 'unic' },
	allStylisticSets: {
		title: 'All Stylistic Sets',
		feature: 'ss01 ss02 ss03 ss04 ss05 ss06 ss07 ss08 ss09 ss10 ss11 ss12 ss13 ss14 ss15 ss16 ss17 ss18 ss19 ss20',
	},
	stylisticSet1: { title: 'Stylistic Set 1', feature: 'ss01' },
	stylisticSet2: { title: 'Stylistic Set 2', feature: 'ss02' },
	stylisticSet3: { title: 'Stylistic Set 3', feature: 'ss03' },
	stylisticSet4: { title: 'Stylistic Set 4', feature: 'ss04' },
	stylisticSet5: { title: 'Stylistic Set 5', feature: 'ss05' },
	stylisticSet6: { title: 'Stylistic Set 6', feature: 'ss06' },
	stylisticSet7: { title: 'Stylistic Set 7', feature: 'ss07' },
	stylisticSet8: { title: 'Stylistic Set 8', feature: 'ss08' },
	stylisticSet9: { title: 'Stylistic Set 9', feature: 'ss09' },
	stylisticSet10: { title: 'Stylistic Set 10', feature: 'ss10' },
	stylisticSet11: { title: 'Stylistic Set 11', feature: 'ss11' },
	stylisticSet12: { title: 'Stylistic Set 12', feature: 'ss12' },
	stylisticSet13: { title: 'Stylistic Set 13', feature: 'ss13' },
	stylisticSet14: { title: 'Stylistic Set 14', feature: 'ss14' },
	stylisticSet15: { title: 'Stylistic Set 15', feature: 'ss15' },
	stylisticSet16: { title: 'Stylistic Set 16', feature: 'ss16' },
	stylisticSet17: { title: 'Stylistic Set 17', feature: 'ss17' },
	stylisticSet18: { title: 'Stylistic Set 18', feature: 'ss18' },
	stylisticSet19: { title: 'Stylistic Set 19', feature: 'ss19' },
	stylisticSet20: { title: 'Stylistic Set 20', feature: 'ss20' },
};
