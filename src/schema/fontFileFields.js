// Factory for the font document's `fileInput` object — the per-format file set every foundry shares, plus the env-gated trial file
import { getTrialConfig } from '../utils/trialFonts.js';

/**
 * Delivery formats in the order they are shown in the Studio. `ttf` carries an accept filter
 * because it is the source the worker converts everything else from.
 */
const BASE_FORMATS = [
	{ name: 'ttf', title: 'TTF file', options: { accept: '.ttf' } },
	{ name: 'otf', title: 'OTF file' },
	{ name: 'woff', title: 'WOFF file' },
	{ name: 'woff2', title: 'WOFF2 file' },
	{ name: 'eot', title: 'EOT file' },
	{ name: 'svg', title: 'SVG file' },
	{ name: 'css', title: 'CSS file' },
];

/**
 * Files the site generates rather than the curator uploading. Kept separate so a foundry without a
 * subset-capable fontWorker can leave them out instead of showing fields nothing will ever fill.
 */
const DERIVED_FORMATS = [
	{
		name: 'woff2_subset',
		title: 'WOFF2 Subset',
		description: 'Auto-generated Latin display subset (~10-30 KB). Re-upload the TTF to regenerate.',
	},
	{
		name: 'woff2_web',
		title: 'WOFF2 Web',
		description: 'Auto-generated fingerprinted copy for web delivery. Keep woff2 clean for purchase delivery.',
	},
];

/**
 * Builds the trial download field. The site's fontWorker writes the Unicode range and label the
 * file was built with alongside the asset, which is how the Studio tells a current trial from one
 * made under an older setting.
 * @param {object} config - from getTrialConfig
 * @returns {object} format definition
 */
function trialFormat(config) {
	return {
		name: 'trial',
		title: 'Trial OTF',
		description: `Auto-generated ${config.label} trial for download: the OTF (or TTF) subset to ${config.unicodeRange || 'the trial Unicode range'} and renamed "<Family> ${config.label}". Rebuilt on upload.`,
		fields: [
			{ name: 'unicodeRange', title: 'Unicode range', type: 'string', readOnly: true },
			{ name: 'label', title: 'Label', type: 'string', readOnly: true },
		],
	};
}

/** Default help text shown under the field in the Studio */
const DEFAULT_DESCRIPTION = "This section is meant for fine tuning. It is recommended to batch upload your pre-built files in their respective Typeface page. EOT/SVG are rarely needed and can cost $$ to store so we don't generate them by default.";

/**
 * Builds the `fileInput` object field for a font document.
 *
 * Every foundry site stores the same per-format file set, so hand-copying it into each schema let
 * the shape drift. Consumers spread the result and add their own `group`.
 *
 * @param {object} [options]
 * @param {string} [options.name] - Field name, defaults to `fileInput`
 * @param {string} [options.title] - Field title, defaults to `Files`
 * @param {string} [options.group] - Studio field group, omitted when not given
 * @param {string} [options.description] - Help text; pass null to omit
 * @param {object} [options.input] - Input component, normally SingleUploaderTool
 * @param {boolean} [options.derived] - Include woff2_subset and woff2_web. Requires a
 *   subset-capable /api/sanity/fontWorker on the consuming site
 * @param {boolean} [options.trial] - Include the trial download file. Defaults to on when the studio
 *   sets SANITY_STUDIO_TRIAL_UNICODE_RANGE and `derived` is on, so script variants stay without one.
 *   Requires a fontWorker handling `generate-trial`
 * @param {string[]} [options.formats] - Override the delivery format list
 * @returns {object} Sanity object field definition
 */
export function createFontFileFields({
	name = 'fileInput',
	title = 'Files',
	group,
	description = DEFAULT_DESCRIPTION,
	input,
	derived = true,
	trial,
	formats,
} = {}) {
	const selected = formats
		? BASE_FORMATS.filter(f => formats.includes(f.name))
		: BASE_FORMATS;

	const trialConfig = getTrialConfig();
	const includeTrial = trial ?? (derived && trialConfig.enabled);

	const fields = [
		...selected,
		...(derived ? DERIVED_FORMATS : []),
		...(includeTrial ? [trialFormat(trialConfig)] : []),
	].map(format => ({
		title: format.title,
		name: format.name,
		type: 'file',
		...(format.options ? { options: format.options } : {}),
		...(format.description ? { description: format.description } : {}),
		...(format.fields ? { fields: format.fields } : {}),
	}));

	const field = {
		title,
		name,
		type: 'object',
		fields,
	};

	if (group) field.group = group;
	if (description) field.description = description;
	if (input) field.components = { input };

	return field;
}

/** Format names the factory can emit, for callers that want to validate an override */
export const FONT_FILE_FORMATS = [
	...BASE_FORMATS.map(f => f.name),
	...DERIVED_FORMATS.map(f => f.name),
	'trial',
];
