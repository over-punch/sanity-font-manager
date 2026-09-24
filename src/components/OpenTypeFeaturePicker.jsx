// String input that picks one of the typeface's DETECTED openType features, storing its openType key

import React, { useCallback } from 'react';
import { set, unset, useFormValue } from 'sanity';
import { Stack, Select, Text, Card } from '@overpunch/sanity-ui-compat';
import { listDetectedFeatures } from '../utils/openTypeShowcase';

/** Where the document keeps its openType field unless the schema says otherwise. */
const DEFAULT_OPENTYPE_PATH = ['openType'];

/**
 * Replaces a hard-coded list of every OpenType feature with the ones this typeface actually has.
 *
 * Options come from the document's openType field — the list "Detect OTF" fills and the foundry
 * reviews — so a card can only point at a feature the fonts support, and it inherits that feature's
 * reviewed title and tag instead of repeating them. The stored value is the openType key
 * (`stylisticSet1`), never a CSS string.
 *
 * Set `options.openTypePath` on the field when the openType field lives somewhere other than the
 * document root.
 */
export const OpenTypeFeaturePicker = (props) => {
	const { value, onChange, schemaType, readOnly, elementProps } = props;
	const openTypePath = schemaType?.options?.openTypePath || DEFAULT_OPENTYPE_PATH;
	const openType = useFormValue(openTypePath);
	const detected = listDetectedFeatures(openType);
	const isStale = !!value && !detected.some((feature) => feature.key === value);

	/** Stores the picked openType key, or clears the field when the blank option is chosen. */
	const handleChange = useCallback(
		(event) => {
			const next = event.currentTarget.value;
			onChange(next ? set(next) : unset());
		},
		[onChange]
	);

	return (
		<Stack space={3}>
			<Select {...elementProps} value={value || ''} readOnly={readOnly} onChange={handleChange}>
				<option value="">Select a detected feature…</option>
				{detected.map((feature) => (
					<option key={feature.key} value={feature.key}>
						{feature.title}{feature.feature ? ` — ${feature.feature}` : ''}
					</option>
				))}
				{/* Keep a stale value selectable so opening the card never silently drops it. */}
				{isStale && <option value={value}>{value} (not detected)</option>}
			</Select>
			{!detected.length && (
				<Card padding={3} radius={2} tone="caution" border>
					<Text size={1}>
						No detected features yet. Run “Detect OTF” in the OpenType field, review the list, then pick one here.
					</Text>
				</Card>
			)}
			{isStale && !!detected.length && (
				<Card padding={3} radius={2} tone="caution" border>
					<Text size={1}>
						“{value}” is not in this typeface’s detected OpenType features. Re-run “Detect OTF” or pick another feature.
					</Text>
				</Card>
			)}
		</Stack>
	);
};
