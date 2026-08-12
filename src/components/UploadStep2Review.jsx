// Step 2 — Processing & Review with settings, FontReviewCard, BulkActions, and subfamily grouping

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { Box, Grid, Stack, Flex, Text, Label, Switch, Button, Card, Spinner, Badge, Tooltip } from '@sanity/ui';
import { InfoOutlineIcon } from '@sanity/icons';
import { PLAN_PHASE, FONT_STATUS, RECOMMENDATION } from '../utils/planTypes';
import FontReviewCard from './FontReviewCard';
import BulkActions from './BulkActions';
import PriceInput from './PriceInput';
import MergeFontsDialog from './MergeFontsDialog';

/** True when an entry carries a TTF or OTF — the only files metadata generation can read */
function hasOutlineFile(entry) {
	return (entry.files || []).some(f => /\.(ttf|otf)$/i.test(f.name || ''));
}

/** Determines whether a font entry will create or update a document */
function isUpdateEntry(entry) {
	const d = entry.decisions?.existingDocument;
	const choice = d?.userChoice;
	const rec = d?.recommendation;
	return choice === 'update' || (!choice && (rec === RECOMMENDATION.USE_EXACT || rec === RECOMMENDATION.USE_CANDIDATE));
}

/**
 * Step 2 — displays processing progress and font review cards with full editing.
 */
export default function UploadStep2Review({
	plan,
	dispatch,
	onCancelProcessing,
	onReadyToUpload,
	onStartExecution,
	processingCancelled,
	onRetryFont,
}) {
	const isProcessing = plan.phase === PLAN_PHASE.PROCESSING;
	const isReviewing = plan.phase === PLAN_PHASE.REVIEWING || plan.phase === PLAN_PHASE.READY;

	// Settings state (editable in review)
	// Foundries pricing at the typeface/licence level switch this off via the field's schema options.
	const pricingEnabled = plan.settings?.pricing !== false;
	const [localPrice, setLocalPrice] = useState(String(plan.settings?.price || 0));
	const [localPreserveShortenedNames, setLocalPreserveShortenedNames] = useState(plan.settings?.preserveShortenedNames ?? true);
	const [localPreserveFileNames, setLocalPreserveFileNames] = useState(plan.settings?.preserveFileNames ?? false);

	// Search, filter, and sort state
	const [searchQuery, setSearchQuery] = useState('');
	const [filterBy, setFilterBy] = useState('all');
	const [allExpanded, setAllExpanded] = useState(false);
	const [sortBy, setSortBy] = useState('weight');
	const [sortDir, setSortDir] = useState('asc');

	// Merge selection — tempIds ticked for merging, and the entries currently in the dialog
	const [selectedIds, setSelectedIds] = useState([]);
	const [mergeCandidates, setMergeCandidates] = useState(null);

	const fontEntries = useMemo(() => Object.values(plan.fonts), [plan.fonts]);
	const processedCount = fontEntries.filter(f => f.status === FONT_STATUS.PROCESSED).length;
	const errorCount = fontEntries.filter(f => f.status === FONT_STATUS.ERROR).length;
	const totalCount = plan.processingProgress.total;

	// Debug: log all fonts with their subfamily assignment for investigation
	useEffect(() => {
		if (!isReviewing) return;
		const processed = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR);
		if (processed.length === 0) return;

		// Group by subfamily for clear logging
		const bySubfamily = {};
		processed.forEach(f => {
			const sf = f.subfamily || '(none)';
			if (!bySubfamily[sf]) bySubfamily[sf] = [];
			bySubfamily[sf].push(f);
		});

		console.group('[UploadStep2Review] Subfamily assignments');
		Object.entries(bySubfamily).forEach(([sf, fonts]) => {
			console.group(`Subfamily: "${sf}" (${fonts.length} font${fonts.length === 1 ? '' : 's'})`);
			fonts.forEach(f => {
				console.log(`  "${f.title}" (id: ${f.documentId})`, {
					sourceFile: f.sourceFileName,
					weightName: f.weightName,
					style: f.style,
					subfamily: f.subfamily,
					subfamilyDecision: f.decisions?.subfamily,
					parsedMetadata: {
						familyName: f.parsedMetadata?.familyName,
						fullName: f.parsedMetadata?.fullName,
						preferredFamily: f.parsedMetadata?.preferredFamily,
						preferredSubfamily: f.parsedMetadata?.preferredSubfamily,
					},
				});
			});
			console.groupEnd();
		});
		console.groupEnd();
	}, [isReviewing, fontEntries]);

	// Count creates vs updates
	const createCount = useMemo(() =>
		fontEntries.filter(f => f.status !== FONT_STATUS.ERROR && !isUpdateEntry(f)).length,
		[fontEntries]
	);
	const updateCount = useMemo(() =>
		fontEntries.filter(f => f.status !== FONT_STATUS.ERROR && isUpdateEntry(f)).length,
		[fontEntries]
	);

	// Filter and search
	const visibleEntries = useMemo(() => {
		let entries = fontEntries;

		// Apply filter
		if (filterBy === 'create') {
			entries = entries.filter(f => !isUpdateEntry(f) && f.status !== FONT_STATUS.ERROR);
		} else if (filterBy === 'update') {
			entries = entries.filter(f => isUpdateEntry(f));
		} else if (filterBy === 'error') {
			entries = entries.filter(f => f.status === FONT_STATUS.ERROR);
		} else if (filterBy === 'conflict') {
			entries = entries.filter(f => f._idConflict);
		} else if (filterBy === 'missing-title') {
			entries = entries.filter(f => f.status !== FONT_STATUS.ERROR && !f.title?.trim());
		} else if (filterBy === 'missing-id') {
			entries = entries.filter(f => f.status !== FONT_STATUS.ERROR && !f.documentId?.trim());
		} else if (filterBy === 'no-outline') {
			entries = entries.filter(f => f.status !== FONT_STATUS.ERROR && !hasOutlineFile(f));
		} else if (filterBy === 'style:italic') {
			entries = entries.filter(f => f.style === 'Italic' && f.status !== FONT_STATUS.ERROR);
		} else if (filterBy === 'style:regular') {
			entries = entries.filter(f => f.style === 'Regular' && f.status !== FONT_STATUS.ERROR);
		} else if (filterBy.startsWith('sf:')) {
			const sf = filterBy.slice(3);
			entries = entries.filter(f => f.subfamily === sf);
		}

		// Apply search
		if (searchQuery.trim()) {
			const q = searchQuery.toLowerCase().trim();
			entries = entries.filter(f =>
				f.title?.toLowerCase().includes(q) ||
				f.documentId?.toLowerCase().includes(q) ||
				f.sourceFileName?.toLowerCase().includes(q) ||
				f.weightName?.toLowerCase().includes(q)
			);
		}

		return entries;
	}, [fontEntries, filterBy, searchQuery]);

	const visibleTempIds = useMemo(() => visibleEntries.map(e => e.tempId), [visibleEntries]);
	const hasConflicts = fontEntries.some(f => f._idConflict);

	// Conflicting entries grouped by the document ID they fight over — each group is one merge.
	const conflictGroups = useMemo(() => {
		const groups = {};
		for (const entry of fontEntries) {
			if (!entry._idConflict) continue;
			if (!groups[entry.documentId]) groups[entry.documentId] = [];
			groups[entry.documentId].push(entry);
		}
		return groups;
	}, [fontEntries]);

	/** Tick or untick an entry for merging */
	const handleToggleSelect = useCallback((tempId) => {
		setSelectedIds(prev => prev.includes(tempId) ? prev.filter(id => id !== tempId) : [...prev, tempId]);
	}, []);

	const handleClearSelection = useCallback(() => setSelectedIds([]), []);

	/** Open the merge dialog for the ticked entries */
	const handleMergeSelected = useCallback(() => {
		const entries = selectedIds.map(id => plan.fonts[id]).filter(Boolean);
		if (entries.length >= 2) setMergeCandidates(entries);
	}, [selectedIds, plan.fonts]);

	/** Open the merge dialog for one conflicting document ID */
	const handleMergeConflictGroup = useCallback((documentId) => {
		const entries = conflictGroups[documentId] || [];
		if (entries.length >= 2) setMergeCandidates(entries);
	}, [conflictGroups]);

	const handleMergeConfirm = useCallback(({ tempIds, primaryTempId, fileSources }) => {
		dispatch({ type: 'MERGE_FONTS', tempIds, primaryTempId, fileSources });
		setSelectedIds([]);
		setMergeCandidates(null);
	}, [dispatch]);

	/** Sort comparator based on current sortBy/sortDir */
	const sortEntries = useCallback((a, b) => {
		const dir = sortDir === 'asc' ? 1 : -1;
		let cmp = 0;
		switch (sortBy) {
			case 'title':
				cmp = (a.title || '').localeCompare(b.title || '');
				break;
			case 'weight':
				cmp = a.weight - b.weight;
				if (cmp === 0) {
					// Secondary sort: italic after regular at same weight
					if (a.style === 'Italic' && b.style !== 'Italic') cmp = 1;
					else if (a.style !== 'Italic' && b.style === 'Italic') cmp = -1;
				}
				break;
			case 'style':
				cmp = (a.style || '').localeCompare(b.style || '');
				break;
			case 'files':
				cmp = (a.files?.length || 0) - (b.files?.length || 0);
				break;
			case 'action': {
				const aUpdate = isUpdateEntry(a) ? 1 : 0;
				const bUpdate = isUpdateEntry(b) ? 1 : 0;
				cmp = aUpdate - bUpdate;
				break;
			}
			default:
				cmp = a.weight - b.weight;
		}
		return cmp * dir;
	}, [sortBy, sortDir]);

	/** Toggle sort — click same column to flip direction, different column to sort asc */
	const handleSort = useCallback((column) => {
		if (sortBy === column) {
			setSortDir(d => d === 'asc' ? 'desc' : 'asc');
		} else {
			setSortBy(column);
			setSortDir('asc');
		}
	}, [sortBy]);

	// Group by subfamily for display — always show headers
	const groupedEntries = useMemo(() => {
		const groups = {};
		for (const entry of visibleEntries) {
			const sf = entry.subfamily || 'Regular';
			if (!groups[sf]) groups[sf] = [];
			groups[sf].push(entry);
		}
		// Sort entries within each group
		Object.values(groups).forEach(g => g.sort(sortEntries));
		// Sort groups: "Regular" first, then alphabetically
		const sorted = {};
		const keys = Object.keys(groups).sort((a, b) => {
			if (a === 'Regular') return -1;
			if (b === 'Regular') return 1;
			return a.localeCompare(b);
		});
		keys.forEach(k => { sorted[k] = groups[k]; });
		return sorted;
	}, [visibleEntries]);

	// Validation — each entry carries the filter that isolates the fonts it refers to, so the
	// message is a way to reach them rather than a hunt through the list.
	const validationErrors = useMemo(() => {
		const errors = [];
		const uploadable = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR);
		const plural = (n) => (n === 1 ? '' : 's');

		const missingTitles = uploadable.filter(f => !f.title || f.title.trim() === '');
		if (missingTitles.length > 0) {
			errors.push({ message: `${missingTitles.length} font${plural(missingTitles.length)} missing a title`, filter: 'missing-title' });
		}
		const missingIds = uploadable.filter(f => !f.documentId || f.documentId.trim() === '');
		if (missingIds.length > 0) {
			errors.push({ message: `${missingIds.length} font${plural(missingIds.length)} missing a document ID`, filter: 'missing-id' });
		}
		if (hasConflicts) {
			const conflictCount = uploadable.filter(f => f._idConflict).length;
			errors.push({ message: `${conflictCount} font${plural(conflictCount)} with duplicate document IDs`, filter: 'conflict' });
		}
		return errors;
	}, [fontEntries, hasConflicts]);

	// Non-blocking warnings — the upload succeeds, but the result is not what most people expect.
	const validationWarnings = useMemo(() => {
		const warnings = [];
		const uploadable = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR);
		const plural = (n) => (n === 1 ? '' : 's');

		const noOutline = uploadable.filter(f => !hasOutlineFile(f));
		if (noOutline.length > 0) {
			warnings.push({
				message: `${noOutline.length} font${plural(noOutline.length)} without a TTF or OTF — written without metrics, character set or variable instances`,
				filter: 'no-outline',
			});
		}

		const duplicateCount = uploadable.reduce((n, f) => n + (f.duplicateFiles?.length || 0), 0);
		if (duplicateCount > 0) {
			warnings.push({
				message: `${duplicateCount} file${plural(duplicateCount)} skipped as a duplicate format`,
				filter: null,
			});
		}
		return warnings;
	}, [fontEntries]);

	const canUploadValidation = isReviewing && processedCount > 0 && validationErrors.length === 0;

	const handleUpload = useCallback(() => {
		if (validationErrors.length > 0) {
			window.alert('Please fix the following before uploading:\n\n• ' + validationErrors.map(e => e.message).join('\n• '));
			return;
		}
		onStartExecution();
	}, [validationErrors, onStartExecution]);

	const handleToggleExpandAll = useCallback(() => {
		setAllExpanded(v => !v);
	}, []);

	return (
		<Stack space={3}>
			{/* Processing progress */}
			{isProcessing && (
				<Card border padding={3} radius={2}>
					<Stack space={3}>
						<Flex align="center" gap={3}>
							<Spinner />
							<Text size={1}>
								Processing {plan.processingProgress.completed} of {totalCount} files...
							</Text>
						</Flex>
						<Box style={{ height: 4, background: 'var(--card-border-color)', borderRadius: 2, overflow: 'hidden' }}>
							<Box
								style={{
									height: '100%',
									width: '100%',
									transformOrigin: 'left',
									transform: `scaleX(${totalCount > 0 ? plan.processingProgress.completed / totalCount : 0})`,
									background: '#43b649',
									transition: 'transform 0.3s ease-out',
									borderRadius: 2,
								}}
							/>
						</Box>
						{plan.processingProgress.currentFile && (
							<Text size={0} muted style={{ fontFamily: 'monospace' }}>
								{plan.processingProgress.currentFile}
							</Text>
						)}
						<Flex justify="flex-end">
							<Button
								mode="ghost"
								tone="caution"
								text="Cancel Processing"
								fontSize={1}
								padding={2}
								onClick={onCancelProcessing}
							/>
						</Flex>
					</Stack>
				</Card>
			)}

			{/* Processing complete summary */}
			{isReviewing && (
				<Card tone={errorCount > 0 ? 'caution' : 'positive'} border padding={3} radius={2}>
					<Flex align="center" gap={3}>
						<Text size={1} weight="semibold">
							{processedCount} document{processedCount === 1 ? '' : 's'}
						</Text>
						<Flex gap={1}>
							{createCount > 0 && <Badge tone="positive" fontSize={0}>{createCount} create</Badge>}
							{updateCount > 0 && <Badge tone="caution" fontSize={0}>{updateCount} update</Badge>}
							{errorCount > 0 && <Badge tone="critical" fontSize={0}>{errorCount} error{errorCount === 1 ? '' : 's'}</Badge>}
						</Flex>
					</Flex>
				</Card>
			)}

			{/* Settings — price and naming options */}
			{isReviewing && (
				<>
				<Text size={1} weight="semibold">Settings</Text>
				<Card border padding={3} radius={2}>
					<Stack space={3}>
						<Grid columns={[pricingEnabled ? 2 : 1]} gap={4}>
							{pricingEnabled && (
								<Box>
									<PriceInput
										inputPrice={localPrice}
										handleInputChange={(e) => {
											setLocalPrice(e.target.value);
											dispatch({ type: 'SET_SETTINGS', settings: { price: Number(e.target.value) || 0 } });
										}}
									/>
								</Box>
							)}
							<Stack space={3}>
								<Flex align="center" gap={2}>
									<Switch
										checked={localPreserveShortenedNames}
										onChange={(e) => {
											setLocalPreserveShortenedNames(e.target.checked);
											dispatch({
												type: 'SET_SETTINGS',
												settings: { preserveShortenedNames: e.target.checked },
												typefaceTitle: plan.settings?.typefaceTitle || '',
											});
										}}
									/>
									<Tooltip
										content={<Box padding={2} style={{ maxWidth: 260 }}><Text size={1} style={{ lineHeight: 1.6 }}>Abbreviations in font names are kept as-is (e.g. "XNarrow" stays "XNarrow").</Text></Box>}
										placement="top"
										portal
									>
										<Flex align="center" gap={1} style={{ cursor: 'default' }}>
											<Label>Preserve shortened names</Label>
											<InfoOutlineIcon style={{ opacity: 0.5, display: 'block' }} />
										</Flex>
									</Tooltip>
								</Flex>
								<Flex align="center" gap={2}>
									<Switch
										checked={localPreserveFileNames}
										onChange={(e) => {
											setLocalPreserveFileNames(e.target.checked);
											dispatch({
												type: 'SET_SETTINGS',
												settings: { preserveFileNames: e.target.checked },
												typefaceTitle: plan.settings?.typefaceTitle || '',
											});
										}}
									/>
									<Tooltip
										content={<Box padding={2} style={{ maxWidth: 260 }}><Text size={1} style={{ lineHeight: 1.6 }}>Original filename is used for the font title and document ID instead of embedded font metadata.</Text></Box>}
										placement="top"
										portal
									>
										<Flex align="center" gap={1} style={{ cursor: 'default' }}>
											<Label>Preserve file names</Label>
											<InfoOutlineIcon style={{ opacity: 0.5, display: 'block' }} />
										</Flex>
									</Tooltip>
								</Flex>
							</Stack>
						</Grid>
					</Stack>
				</Card>
				</>
			)}

			{/* Bulk actions bar */}
			{fontEntries.length > 0 && (
				<BulkActions
					fonts={plan.fonts}
					dispatch={dispatch}
					searchQuery={searchQuery}
					onSearchChange={setSearchQuery}
					filterBy={filterBy}
					onFilterChange={setFilterBy}
					allExpanded={allExpanded}
					onToggleExpandAll={handleToggleExpandAll}
					visibleTempIds={visibleTempIds}
					selectedCount={selectedIds.length}
					onMergeSelected={handleMergeSelected}
					onClearSelection={handleClearSelection}
				/>
			)}

			{/* Expand All — between filters and column headers */}
			{fontEntries.length > 0 && isReviewing && (
				<Flex justify="flex-start" paddingY={1}>
					<Button
						mode="ghost"
						fontSize={0}
						padding={2}
						text={allExpanded ? 'Collapse All' : 'Expand All'}
						onClick={handleToggleExpandAll}
						style={{ cursor: 'pointer' }}
					/>
				</Flex>
			)}

			{/* Sortable column header row */}
			{fontEntries.length > 0 && isReviewing && (
				<Flex
					align="center"
					gap={2}
					paddingX={2}
					paddingY={1}
					style={{ borderBottom: '1px solid var(--card-border-color)', userSelect: 'none' }}
				>
					{/* Spacers for the merge checkbox and the expand chevron */}
					<Box style={{ width: 18 }} />
					<Box style={{ width: 20 }} />
					{[
						{ key: 'title', label: 'Font Title', style: { flex: 1, cursor: 'pointer' } },
						{ key: 'weight', label: 'Weight', style: { width: 50, textAlign: 'center', cursor: 'pointer' } },
						{ key: 'style', label: 'Style', style: { width: 50, textAlign: 'center', cursor: 'pointer' } },
						{ key: 'files', label: 'Files', style: { width: 40, textAlign: 'center', cursor: 'pointer' } },
						{ key: 'action', label: 'Action', style: { width: 55, textAlign: 'center', cursor: 'pointer' } },
					].map(col => (
						<Text
							key={col.key}
							size={0}
							weight="semibold"
							muted={sortBy !== col.key}
							style={col.style}
							onClick={() => handleSort(col.key)}
						>
							{col.label} {sortBy === col.key ? (sortDir === 'asc' ? '↑' : '↓') : ''}
						</Text>
					))}
				</Flex>
			)}

			{/* Font cards grouped by subfamily */}
			{Object.entries(groupedEntries).map(([subfamily, entries]) => (
				<Stack key={subfamily} space={1}>
					<Card padding={2} radius={1} style={{ background: 'var(--card-muted-bg-color)' }}>
						<Flex align="center" gap={2}>
							<Text size={1} weight="semibold">
								{subfamily}
							</Text>
							<Badge mode="outline" fontSize={0}>{entries.length}</Badge>
						</Flex>
					</Card>
					<Stack space={0}>
						{entries.map(entry => (
							<FontReviewCard
								key={entry.tempId}
								entry={entry}
								dispatch={dispatch}
								allExpanded={allExpanded}
								typefaceTitle={plan.settings?.typefaceTitle}
								price={plan.settings?.price}
								pricing={plan.settings?.pricing}
								sell={plan.settings?.sell}
								selected={selectedIds.includes(entry.tempId)}
								onToggleSelect={handleToggleSelect}
								onRetry={onRetryFont}
							/>
						))}
					</Stack>
				</Stack>
			))}

			{/* Empty state */}
			{visibleEntries.length === 0 && fontEntries.length > 0 && (
				<Card border padding={4} radius={2}>
					<Text size={1} muted align="center">No fonts match the current filter</Text>
				</Card>
			)}

			{/* Validation errors — click one to filter the list down to the fonts it names */}
			{isReviewing && validationErrors.length > 0 && (
				<Card tone="critical" border padding={2} radius={2}>
					<Stack space={1}>
						{validationErrors.map(err => (
							<Flex key={err.filter} align="center" justify="space-between" gap={2}>
								<Text size={0} tone="critical">• {err.message}</Text>
								<Button
									mode="bleed"
									tone="critical"
									fontSize={0}
									padding={1}
									text="Show"
									onClick={() => setFilterBy(err.filter)}
									style={{ cursor: 'pointer', flexShrink: 0 }}
								/>
							</Flex>
						))}
					</Stack>
				</Card>
			)}

			{/* Warnings that do not block the upload */}
			{isReviewing && validationWarnings.length > 0 && (
				<Card tone="caution" border padding={2} radius={2}>
					<Stack space={1}>
						{validationWarnings.map(warn => (
							<Flex key={warn.message} align="center" justify="space-between" gap={2}>
								<Text size={0} tone="caution">• {warn.message}</Text>
								{warn.filter && (
									<Button
										mode="bleed"
										tone="caution"
										fontSize={0}
										padding={1}
										text="Show"
										onClick={() => setFilterBy(warn.filter)}
										style={{ cursor: 'pointer', flexShrink: 0 }}
									/>
								)}
							</Flex>
						))}
					</Stack>
				</Card>
			)}

			{/* Duplicate IDs — offer the merge that resolves each one. Two entries usually mean one
			    style whose formats parsed under slightly different names, not two documents. */}
			{isReviewing && Object.keys(conflictGroups).length > 0 && (
				<Card tone="caution" border padding={3} radius={2}>
					<Stack space={3}>
						<Text size={1} weight="semibold">Duplicate document IDs</Text>
						{Object.entries(conflictGroups).map(([documentId, group]) => (
							<Flex key={documentId} align="center" justify="space-between" gap={3}>
								<Stack space={1} style={{ minWidth: 0 }}>
									<Text size={0} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{documentId}</Text>
									<Text size={0} muted>{group.map(e => e.title).join('  ·  ')}</Text>
								</Stack>
								<Button
									mode="ghost"
									tone="primary"
									fontSize={0}
									padding={2}
									text={`Merge ${group.length}`}
									onClick={() => handleMergeConflictGroup(documentId)}
									style={{ flexShrink: 0, cursor: 'pointer' }}
								/>
							</Flex>
						))}
						<Text size={0} muted style={{ lineHeight: 1.6 }}>
							Merging keeps one entry's reviewed values and adds the others' font files to it.
							Give them different IDs instead if they really are separate documents.
						</Text>
					</Stack>
				</Card>
			)}

			{/* Merge dialog */}
			{mergeCandidates && (
				<MergeFontsDialog
					entries={mergeCandidates}
					onClose={() => setMergeCandidates(null)}
					onConfirm={handleMergeConfirm}
				/>
			)}

			{/* Upload button */}
			{isReviewing && processedCount > 0 && (
				<Flex justify="flex-end" gap={2} style={{ position: 'sticky', bottom: 0, zIndex: 2, background: 'var(--card-bg-color)', borderTop: '1px solid var(--card-border-color)', paddingTop: 8, paddingBottom: 4 }}>
					<Button
						mode="default"
						tone="primary"
						text={`Upload ${processedCount} Font${processedCount === 1 ? '' : 's'} to Sanity`}
						disabled={!canUploadValidation}
						onClick={handleUpload}
					/>
				</Flex>
			)}
		</Stack>
	);
}
