// Factory for the OpenType showcase field — demo cards that reference the typeface's detected openType features
import { StringIcon } from '@overpunch/sanity-ui-compat/icons';
import { OpenTypeFeaturePicker } from '../components/OpenTypeFeaturePicker.jsx';
import { OPENTYPE_FEATURE_TAGS } from './openTypeFeatureTags.js';

/** Display sizes a card can ask for; the front end maps each value to its own type scale. */
const SHOWCASE_SIZES = [
	{ title: 'XLarge', value: 'xl' },
	{ title: 'Large', value: 'lg' },
	{ title: 'Medium', value: 'md' },
	{ title: 'Small', value: 'sm' },
];

/** Name of the collapsed fieldset holding a card's italics and default-off toggles and its CSS override. */
const OPTIONS_FIELDSET = 'options';

/**
 * Builds an array field of OpenType demo cards.
 *
 * The openType field stays the single source of truth for WHICH features a typeface has and what
 * they are called: "Detect OTF" finds them and the foundry reviews the titles and tags. A card only
 * adds what is its own — the demo text, the glyphs the feature affects, and display options — and
 * points at a detected feature through `OpenTypeFeaturePicker`. Front ends resolve a card's label
 * and CSS with `resolveShowcaseCard(card, openType)`.
 *
 * It supersedes the static `stylisticSetField`, whose cards carried their own copy of every feature
 * name and tag. The member shape is compatible: `content`, `label`, `specialtyCss`, `ligatures`,
 * `calt`, `italics` and `size` keep their names, so a studio can adopt this in place — pass the
 * existing array's `name` and `memberName`, and `legacyFeatureField: true` to keep the old
 * `stylisticFeature` string readable (hidden) until its cards are migrated to `feature`.
 *
 * @param {object} [options]
 * @param {string} [options.name='openTypeShowcase'] - field name
 * @param {string} [options.title='OpenType Feature Showcase'] - field title
 * @param {string} [options.description] - field description; a default explains the ` syntax
 * @param {string} [options.group] - field group
 * @param {string} [options.memberName='featuredWord'] - `_type` of the array members
 * @param {string[]} [options.openTypePath=['openType']] - document path of the openType field
 * @param {boolean} [options.sizes=true] - include the display size radio
 * @param {boolean} [options.legacyFeatureField=false] - keep a hidden `stylisticFeature` string
 * @returns {object} Sanity array field definition
 */
export function createOpenTypeShowcaseField({
	name = 'openTypeShowcase',
	title = 'OpenType Feature Showcase',
	description = 'One card per demo. Pick a detected feature, then write a letter, word or phrase and wrap the part the feature applies to in ` characters — "L`if`t" applies it to "if".',
	group,
	memberName = 'featuredWord',
	openTypePath = ['openType'],
	sizes = true,
	legacyFeatureField = false,
} = {}) {
	const memberFields = [
		{
			title: 'OpenType Feature',
			name: 'feature',
			type: 'string',
			description: 'Only features detected and reviewed in the OpenType field are listed. The name and tag come from there.',
			components: { input: OpenTypeFeaturePicker },
			options: { openTypePath },
			validation: (Rule) =>
				Rule.custom((value, context) => {
					const parent = context?.parent || {};
					if (value || parent.specialtyCss || parent.stylisticFeature) return true;
					return 'Pick a detected feature, or this card has nothing to switch on.';
				}).warning(),
		},
		{
			title: 'Content',
			name: 'content',
			type: 'text',
			rows: 3,
		},
		{
			title: 'Corresponding glyphs',
			name: 'glyphs',
			type: 'text',
			rows: 3,
			description: 'Every glyph this feature affects, shown under the demo. For features that change several forms of one base character, start a new line per base character.',
		},
		{
			title: 'Label override',
			name: 'label',
			type: 'string',
			description: 'Leave blank to use the feature’s title from the OpenType field.',
		},
		...(sizes
			? [
					{
						title: 'Font Size',
						name: 'size',
						type: 'string',
						description: 'XLarge for a single glyph; Large for 2–5 glyphs or two short lines; Medium for 2–3 lines; Small for 3–4 lines.',
						options: { list: SHOWCASE_SIZES, layout: 'radio' },
					},
				]
			: []),
		// The rarely-touched settings sit in a collapsed fieldset so a card opens on what editors
		// actually fill in. A fieldset is form layout only — the stored card stays flat.
		{
			title: 'Only applies to italics',
			name: 'italics',
			type: 'boolean',
			fieldset: OPTIONS_FIELDSET,
		},
		{
			title: 'Disable ligatures by default',
			name: 'ligatures',
			type: 'boolean',
			fieldset: OPTIONS_FIELDSET,
		},
		{
			title: 'Disable contextual alternates by default',
			name: 'calt',
			type: 'boolean',
			fieldset: OPTIONS_FIELDSET,
		},
		{
			title: 'CSS override (advanced)',
			name: 'specialtyCss',
			type: 'string',
			fieldset: OPTIONS_FIELDSET,
			description: 'Replaces the picked feature’s CSS — only for a demo that needs a combination the OpenType field does not list.',
			placeholder: "'c2sc' 1, 'ss02' 1",
		},
		...(legacyFeatureField
			? [
					{
						title: 'Legacy feature CSS',
						name: 'stylisticFeature',
						type: 'string',
						hidden: true,
						readOnly: true,
					},
				]
			: []),
	];

	return {
		title,
		name,
		type: 'array',
		description,
		...(group ? { group } : {}),
		of: [
			{
				title: 'Feature demo',
				name: memberName,
				type: 'object',
				icon: StringIcon,
				fieldsets: [
					{
						name: OPTIONS_FIELDSET,
						title: 'Options',
						options: { collapsible: true, collapsed: true },
					},
				],
				fields: memberFields,
				preview: {
					select: { content: 'content', label: 'label', feature: 'feature' },
					/** Titles the card by its demo text, subtitled by its label or the picked feature. */
					prepare({ content, label, feature }) {
						return {
							title: content || 'Empty demo',
							subtitle: label || OPENTYPE_FEATURE_TAGS[feature]?.title || feature || 'No feature picked',
						};
					},
				},
			},
		],
	};
}
