// Detects and sets active OpenType features on a typeface document from the feature tags stored on all its linked styles

import React, { useState } from 'react';
import { set, useFormValue } from 'sanity';
import { Stack, Button, Text } from '@sanity/ui';
import { useSanityClient } from '../hooks/useSanityClient';
import { detectOpenTypeFeatures } from '../utils/detectOpenTypeFeatures';

/**
 * Reads every linked font's stored `opentypeFeatures.chars`, unions the tags across the family, and
 * patches the field with each supported feature — both the `features` checkbox array and the
 * per-feature sub-objects carrying their canonical `feature` tag.
 */
export const SetOTF = (props) => {
	const { onChange, value = {} } = props;
	const client = useSanityClient();
	const stylesObject = useFormValue(['styles']);
	const [message, setMessage] = useState('');
	const [running, setRunning] = useState(false);

	/** Sets a status message and clears it after 5 seconds */
	const flashMessage = (text) => {
		setMessage(text);
		setTimeout(() => setMessage(''), 5000);
	};

	/** Fetches every linked font and matches their combined feature tags against the configured keys. */
	const detect = async () => {
		if (!stylesObject?.fonts?.length) {
			flashMessage('Error: No fonts found in styles. Please add at least one font first.');
			return;
		}

		const ids = stylesObject.fonts.map((font) => font?._ref).filter(Boolean);
		if (!ids.length) {
			flashMessage('Error: No valid font references in styles.');
			return;
		}

		// Unpublished styles only exist as drafts, so look for both ids and let the draft copy count too.
		const draftIds = ids.map((id) => (id.startsWith('drafts.') ? id : `drafts.${id}`));

		setRunning(true);
		try {
			const fontDocs = await client.fetch(
				`*[_type == "font" && (_id in $ids || _id in $draftIds)]{ _id, opentypeFeatures }`,
				{ ids, draftIds }
			);

			if (!fontDocs?.length) {
				flashMessage(`Error: Could not find any of the ${ids.length} referenced fonts.`);
				return;
			}

			const { features, detected, fontsWithData } = detectOpenTypeFeatures(fontDocs, value);

			if (!fontsWithData) {
				flashMessage(`Error: No OpenType feature data found in any of the ${fontDocs.length} linked styles. Generate font data first.`);
				return;
			}

			onChange(set({ ...value, ...detected, features }));
			flashMessage(
				features.length
					? `Detected ${features.length} features across ${fontsWithData} of ${ids.length} styles.`
					: `No supported features found across ${fontsWithData} of ${ids.length} styles.`
			);
		} catch (err) {
			flashMessage('Error detecting features. Check the console for details.');
			console.error('SetOTF detect error:', err);
		} finally {
			setRunning(false);
		}
	};

	return (
		<Stack className="openType">
			{value?.features?.length > 0 && (
				<Text muted size={1} style={{ marginBottom: '0.5rem' }}>
					Number of features: {value.features.length}
				</Text>
			)}
			{!!stylesObject?.fonts?.length && (
				<Button
					text={running ? 'Detecting…' : 'Detect OTF'}
					mode="ghost"
					disabled={running}
					onClick={detect}
					style={{ borderRadius: '0 3px 0 0', marginBottom: '1rem' }}
				/>
			)}
			{!!message && (
				<Text muted size={1}><br />{message}<br /><br /></Text>
			)}
			{props.renderDefault(props)}
		</Stack>
	);
};
