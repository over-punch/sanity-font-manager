// Step 3.5 — Variable font instance mapping using the production parseVariableFontInstances matcher

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Stack, Flex, Text, Card, Badge, Button, Spinner, Autocomplete } from '@sanity/ui';
import { CheckmarkCircleIcon, CloseCircleIcon, SearchIcon } from '@sanity/icons';
import { nanoid } from 'nanoid';
import { parseVariableFontInstances } from '../utils/parseVariableFontInstances';

/**
 * Step 3.5 — Variable font instance mapping.
 * After upload, fetches the VF documents from Sanity and uses the production
 * parseVariableFontInstances matcher to auto-match instances to static fonts.
 * User can review, override via searchable autocomplete, and save.
 */
export default function UploadStep3bInstances({
	plan,
	executionResult,
	client,
	typefaceTitle,
	onComplete,
}) {
	const [loading, setLoading] = useState(true);
	const [saving, setSaving] = useState(false);
	const [vfMappings, setVfMappings] = useState({});
	const [allStaticFonts, setAllStaticFonts] = useState([]);
	const [filterUnmatched, setFilterUnmatched] = useState(false);

	// Identify VF entries from the plan
	const vfEntries = useMemo(() =>
		Object.values(plan.fonts).filter(f => f.variableFont && f.status !== 'error'),
		[plan.fonts]
	);

	/** Run the production matcher for all VFs — callable on mount and via re-run button */
	const runMatching = useCallback(async () => {
		setLoading(true);
		const mappings = {};

		// Fetch all static fonts for the autocomplete picker
		let staticFonts = [];
		try {
			const typeface = await client.fetch(
				`*[_type == 'typeface' && title == $typefaceTitle][0]{
					'fonts': styles.fonts[]-> {
						_id, title, subfamily, style, weight, weightName, metaData, variableFont
					}
				}`,
				{ typefaceTitle }
			);
			if (typeface?.fonts?.length > 0) {
				staticFonts = typeface.fonts.filter(f => !f.variableFont);
			}
			if (staticFonts.length === 0) {
				staticFonts = await client.fetch(
					`*[_type == 'font' && typefaceName == $typefaceTitle && variableFont != true]{
						_id, title, subfamily, style, weight, weightName, metaData
					}`,
					{ typefaceTitle }
				);
			}
		} catch (err) {
			console.error('[InstanceMapper] Failed to fetch static fonts:', err);
		}

		// Deduplicate by _id (draft + published versions can cause duplicates)
		const deduped = new Map();
		staticFonts.forEach(f => { if (f._id && !deduped.has(f._id)) deduped.set(f._id, f); });
		staticFonts = [...deduped.values()];

		console.log(`[InstanceMapper] Found ${staticFonts.length} static fonts for "${typefaceTitle}"`);
		setAllStaticFonts(staticFonts);

		for (const vf of vfEntries) {
			try {
				const vfDoc = await client.fetch(
					`*[_id == $id][0]{
						_id, title, typefaceName, variableFont, variableInstances, metaData
					}`,
					{ id: vf.documentId }
				);

				if (!vfDoc) {
					console.warn(`[InstanceMapper] VF document not found: ${vf.documentId}`);
					mappings[vf.tempId] = [];
					continue;
				}

				console.log(`[InstanceMapper] Running matcher for VF: ${vfDoc.title}, variableInstances: ${vfDoc.variableInstances ? 'present' : 'missing'}`);

				const instanceMappings = await parseVariableFontInstances(vfDoc, client);

				console.log(`[InstanceMapper] Matched ${instanceMappings.filter(m => m.value).length}/${instanceMappings.length} instances for ${vfDoc.title}`);

				mappings[vf.tempId] = instanceMappings.map(m => ({
					instanceName: m.key,
					matchedFontId: m.value?._ref || '',
					matchedFontTitle: '',
					_key: m._key || nanoid(),
				}));
			} catch (err) {
				console.error(`[InstanceMapper] Error matching VF ${vf.documentId}:`, err);
				mappings[vf.tempId] = [];
			}
		}

		// Resolve matched font titles
		const allMatchedIds = new Set();
		Object.values(mappings).forEach(m => m.forEach(i => { if (i.matchedFontId) allMatchedIds.add(i.matchedFontId); }));
		if (allMatchedIds.size > 0) {
			try {
				const titles = await client.fetch(`*[_id in $ids]{ _id, title }`, { ids: [...allMatchedIds] });
				const titleMap = {};
				titles.forEach(t => { titleMap[t._id] = t.title; });
				Object.values(mappings).forEach(m => {
					m.forEach(i => { if (i.matchedFontId) i.matchedFontTitle = titleMap[i.matchedFontId] || i.matchedFontId; });
				});
			} catch (err) {
				console.warn('[InstanceMapper] Failed to resolve font titles:', err);
			}
		}

		setVfMappings(mappings);
		setLoading(false);
	}, [vfEntries, client, typefaceTitle]);

	// Run on mount
	useEffect(() => { runMatching(); }, [runMatching]);

	// Track claimed font IDs to prevent duplicates in manual selection
	const claimedFontIds = useMemo(() => {
		const claimed = new Set();
		Object.values(vfMappings).forEach(mappings => {
			mappings.forEach(m => { if (m.matchedFontId) claimed.add(m.matchedFontId); });
		});
		return claimed;
	}, [vfMappings]);

	/** Update a single instance mapping */
	const handleMappingChange = useCallback((vfTempId, instanceKey, fontId) => {
		const font = allStaticFonts.find(sf => sf._id === fontId);
		setVfMappings(prev => ({
			...prev,
			[vfTempId]: prev[vfTempId].map(m =>
				m._key === instanceKey
					? { ...m, matchedFontId: fontId, matchedFontTitle: font?.title || fontId }
					: m
			),
		}));
	}, [allStaticFonts]);

	/** Save all mappings — patch each VF document */
	const handleSave = useCallback(async () => {
		setSaving(true);
		const errors = [];

		for (const vf of vfEntries) {
			const mappings = vfMappings[vf.tempId] || [];
			const references = mappings
				.filter(m => m.matchedFontId)
				.map(m => ({
					_key: nanoid(),
					_type: 'object',
					key: m.instanceName,
					value: {
						_type: 'reference',
						_ref: m.matchedFontId,
						_weak: true,
					},
				}));

			try {
				await client.patch(vf.documentId).set({
					variableInstanceReferences: references,
				}).commit();
				console.log(`Patched VF instance mappings: ${vf.documentId} (${references.length} instances)`);
			} catch (err) {
				console.error(`Failed to patch VF ${vf.documentId}:`, err);
				errors.push({ vfTitle: vf.title, error: err.message });
			}
		}

		setSaving(false);
		onComplete({ success: errors.length === 0, errors });
	}, [vfEntries, vfMappings, client, onComplete]);

	// Stats
	const totalInstances = Object.values(vfMappings).reduce((sum, m) => sum + m.length, 0);
	const matchedInstances = Object.values(vfMappings).reduce(
		(sum, m) => sum + m.filter(i => i.matchedFontId).length, 0
	);
	const unmatchedInstances = totalInstances - matchedInstances;

	// Autocomplete options — exclude already-claimed fonts
	const getAutocompleteOptions = useCallback((currentFontId) => {
		return allStaticFonts
			.filter(sf => !claimedFontIds.has(sf._id) || sf._id === currentFontId)
			.map(sf => ({
				value: sf._id,
				payload: sf,
			}));
	}, [allStaticFonts, claimedFontIds]);

	if (loading) {
		return (
			<Card border padding={4} radius={2}>
				<Flex align="center" gap={3} justify="center">
					<Spinner />
					<Text size={1}>Matching variable font instances to static fonts...</Text>
				</Flex>
			</Card>
		);
	}

	if (vfEntries.length === 0) {
		onComplete({ success: true, errors: [] });
		return null;
	}

	return (
		<Stack space={4}>
			{/* Header */}
			<Stack space={2}>
				<Text size={2} weight="semibold">Map Variable Font Instances</Text>
				<Text size={1} muted>
					Review the auto-matched instances below. Each named instance should map to its corresponding static font document.
				</Text>
			</Stack>

			{/* Stats */}
			<Flex gap={2} align="center">
				<Button
					mode="ghost"
					tone="primary"
					icon={SearchIcon}
					text="Re-run Matching"
					fontSize={0}
					padding={2}
					onClick={runMatching}
					disabled={loading}
					style={{ cursor: 'pointer' }}
				/>
				<Badge tone="positive" fontSize={0}>{matchedInstances} matched</Badge>
				{unmatchedInstances > 0 && (
					<Badge
						tone="critical"
						fontSize={0}
						style={{ cursor: 'pointer' }}
						onClick={() => setFilterUnmatched(v => !v)}
					>
						{unmatchedInstances} unmatched {filterUnmatched ? '(showing)' : ''}
					</Badge>
				)}
				{filterUnmatched && (
					<Badge
						mode="outline"
						fontSize={0}
						style={{ cursor: 'pointer' }}
						onClick={() => setFilterUnmatched(false)}
					>
						Clear filter
					</Badge>
				)}
				<Badge mode="outline" fontSize={0}>{allStaticFonts.length} fonts available</Badge>
			</Flex>

			{/* Per-VF mapping sections */}
			{vfEntries.map(vf => {
				const mappings = vfMappings[vf.tempId] || [];
				const displayMappings = filterUnmatched
					? mappings.filter(m => !m.matchedFontId)
					: mappings;
				const vfMatched = mappings.filter(m => m.matchedFontId).length;

				return (
					<Card key={vf.tempId} border padding={3} radius={2}>
						<Stack space={3}>
							{/* VF header */}
							<Flex align="center" gap={2}>
								<Badge tone="primary" fontSize={0}>VF</Badge>
								<Text size={1} weight="semibold">{vf.title}</Text>
								<Text size={0} muted style={{ marginLeft: 'auto' }}>
									{vfMatched}/{mappings.length} matched
								</Text>
							</Flex>

							{/* Column headers */}
							<Flex align="center" gap={2} paddingY={1} style={{ borderBottom: '1px solid var(--card-border-color)' }}>
								<Box style={{ width: 20 }} />
								<Text size={0} weight="semibold" muted style={{ flex: 1 }}>Instance</Text>
								<Text size={0} weight="semibold" muted style={{ flex: 2 }}>Static Font Document</Text>
							</Flex>

							{/* Instance rows */}
							<Stack space={1}>
								{displayMappings.map(mapping => {
									const isMatched = !!mapping.matchedFontId;
									const options = getAutocompleteOptions(mapping.matchedFontId);

									return (
										<Flex
											key={mapping._key}
											align="center"
											gap={2}
											paddingY={2}
											style={{ borderBottom: '1px solid var(--card-border-color)' }}
										>
											<Box style={{ width: 20, flexShrink: 0 }}>
												{isMatched
													? <CheckmarkCircleIcon style={{ color: '#43b649', fontSize: 16 }} />
													: <CloseCircleIcon style={{ color: '#f03e2f', fontSize: 16 }} />
												}
											</Box>

											<Text size={1} style={{ flex: 1, whiteSpace: 'nowrap' }}>{mapping.instanceName}</Text>

											<Box style={{ flex: 2 }}>
												<Autocomplete
													id={`instance-${mapping._key}`}
													options={options}
													value={mapping.matchedFontId}
													placeholder="Search for a font..."
													icon={SearchIcon}
													fontSize={1}
													filterOption={(query, option) => {
														const sf = option.payload;
														const q = query.toLowerCase();
														return (
															sf.title?.toLowerCase().includes(q) ||
															sf._id?.toLowerCase().includes(q) ||
															sf.weightName?.toLowerCase().includes(q) ||
															String(sf.weight).includes(q) ||
															sf.subfamily?.toLowerCase().includes(q)
														);
													}}
													renderOption={(option) => {
														const sf = option.payload;
														const isClaimed = claimedFontIds.has(sf._id) && sf._id !== mapping.matchedFontId;
														return (
															<Card as="button" padding={2} style={{ opacity: isClaimed ? 0.4 : 1 }}>
																<Flex align="center" gap={2}>
																	<Text size={1}>{sf.title}</Text>
																	<Text size={0} muted>{sf.weight} {sf.style}</Text>
																	{sf.subfamily && sf.subfamily !== 'Regular' && (
																		<Badge mode="outline" fontSize={0}>{sf.subfamily}</Badge>
																	)}
																</Flex>
															</Card>
														);
													}}
													renderValue={(value, option) => {
														if (option?.payload) return option.payload.title;
														if (mapping.matchedFontTitle) return mapping.matchedFontTitle;
														const font = allStaticFonts.find(sf => sf._id === value);
														return font?.title || value;
													}}
													onSelect={(value) => handleMappingChange(vf.tempId, mapping._key, value)}
													openButton
												/>
											</Box>
										</Flex>
									);
								})}
							</Stack>

							{mappings.length === 0 && (
								<Text size={1} muted>No named instances found in this variable font.</Text>
							)}
						</Stack>
					</Card>
				);
			})}

			{/* Actions */}
			<Flex justify="flex-end" gap={2} style={{ position: 'sticky', bottom: 0, background: 'var(--card-bg-color)', paddingTop: 8, paddingBottom: 4 }}>
				<Button
					mode="ghost"
					text="Skip — I'll map instances later"
					fontSize={1}
					padding={3}
					onClick={() => onComplete({ success: true, errors: [], skipped: true })}
					style={{ cursor: 'pointer' }}
				/>
				<Button
					mode="default"
					tone="positive"
					text={saving ? 'Saving...' : `Save Mappings (${matchedInstances}/${totalInstances})`}
					fontSize={1}
					padding={3}
					disabled={saving}
					onClick={handleSave}
					style={{ cursor: 'pointer' }}
				/>
			</Flex>
		</Stack>
	);
}
