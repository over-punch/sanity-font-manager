// Bulk actions bar — expand/collapse all, search, filter with counts

import React, { useMemo } from 'react';
import { Flex, Box, Button, TextInput, Select, Text, Label } from '@liiift-studio/sanity-ui-compat';
import { SearchIcon } from '@liiift-studio/sanity-ui-compat/icons';
import { FONT_STATUS, RECOMMENDATION } from '../utils/planTypes';

/** Determines whether a font entry will create or update a document */
function isUpdateEntry(entry) {
	const d = entry.decisions?.existingDocument;
	const choice = d?.userChoice;
	const rec = d?.recommendation;
	return choice === 'update' || (!choice && (rec === RECOMMENDATION.USE_EXACT || rec === RECOMMENDATION.USE_CANDIDATE));
}

/**
 * Sticky bulk actions bar for the review step.
 */
export default function BulkActions({
	fonts,
	dispatch,
	searchQuery,
	onSearchChange,
	filterBy,
	onFilterChange,
	allExpanded,
	onToggleExpandAll,
	visibleTempIds,
	selectedCount = 0,
	onMergeSelected,
	onClearSelection,
}) {
	const fontEntries = useMemo(() => Object.values(fonts), [fonts]);
	const fontCount = fontEntries.length;
	const visibleCount = visibleTempIds.length;

	// Compute counts for each filter category
	const filterCounts = useMemo(() => {
		const createCount = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR && !isUpdateEntry(f)).length;
		const updateCount = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR && isUpdateEntry(f)).length;
		const errorCount = fontEntries.filter(f => f.status === FONT_STATUS.ERROR).length;
		const conflictCount = fontEntries.filter(f => f._idConflict).length;
		const uploadable = fontEntries.filter(f => f.status !== FONT_STATUS.ERROR);
		const missingTitleCount = uploadable.filter(f => !f.title?.trim()).length;
		const missingIdCount = uploadable.filter(f => !f.documentId?.trim()).length;
		const noOutlineCount = uploadable.filter(f =>
			!(f.files || []).some(file => /\.(ttf|otf)$/i.test(file.name || ''))
		).length;
		const italicCount = fontEntries.filter(f => f.style === 'Italic' && f.status !== FONT_STATUS.ERROR).length;
		const regularCount = fontEntries.filter(f => f.style === 'Regular' && f.status !== FONT_STATUS.ERROR).length;

		// Subfamily counts
		const subfamilyCounts = {};
		fontEntries.forEach(f => {
			if (f.status === FONT_STATUS.ERROR) return;
			const sf = f.subfamily || 'Regular';
			subfamilyCounts[sf] = (subfamilyCounts[sf] || 0) + 1;
		});

		return {
			createCount, updateCount, errorCount, conflictCount, italicCount, regularCount,
			missingTitleCount, missingIdCount, noOutlineCount, subfamilyCounts,
		};
	}, [fontEntries]);

	const subfamilies = useMemo(() =>
		Object.keys(filterCounts.subfamilyCounts).sort((a, b) => {
			if (a === 'Regular') return -1;
			if (b === 'Regular') return 1;
			return a.localeCompare(b);
		}),
		[filterCounts]
	);

	return (
		<Flex gap={2} align="center" wrap="wrap" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--card-bg-color)', paddingBottom: 8, paddingTop: 4 }}>
			{/* Search */}
			<Box style={{ flex: 1, minWidth: 150 }}>
				<TextInput
					icon={SearchIcon}
					placeholder="Search fonts..."
					value={searchQuery}
					onChange={(e) => onSearchChange(e.target.value)}
					fontSize={1}
				/>
			</Box>

			{/* Filter by */}
			<Flex align="center" gap={1}>
				<Label size={0} style={{ whiteSpace: 'nowrap' }}>Filter</Label>
				<Select value={filterBy} onChange={(e) => onFilterChange(e.target.value)} fontSize={1} style={{ minWidth: 140 }}>
					<option value="all">All ({fontCount})</option>
					{filterCounts.createCount > 0 && <option value="create">Create ({filterCounts.createCount})</option>}
					{filterCounts.updateCount > 0 && <option value="update">Update ({filterCounts.updateCount})</option>}
					{filterCounts.regularCount > 0 && <option value="style:regular">Regular ({filterCounts.regularCount})</option>}
					{filterCounts.italicCount > 0 && <option value="style:italic">Italic ({filterCounts.italicCount})</option>}
					{filterCounts.errorCount > 0 && <option value="error">Errors ({filterCounts.errorCount})</option>}
					{filterCounts.conflictCount > 0 && <option value="conflict">Conflicts ({filterCounts.conflictCount})</option>}
					{filterCounts.missingTitleCount > 0 && <option value="missing-title">Missing title ({filterCounts.missingTitleCount})</option>}
					{filterCounts.missingIdCount > 0 && <option value="missing-id">Missing ID ({filterCounts.missingIdCount})</option>}
					{filterCounts.noOutlineCount > 0 && <option value="no-outline">No TTF/OTF ({filterCounts.noOutlineCount})</option>}
					{subfamilies.length > 1 && subfamilies.map(sf => (
						<option key={sf} value={`sf:${sf}`}>{sf} ({filterCounts.subfamilyCounts[sf]})</option>
					))}
				</Select>
			</Flex>

			{/* Merge — appears once two or more entries are ticked */}
			{selectedCount > 0 && (
				<Flex align="center" gap={1}>
					<Button
						mode="default"
						tone="primary"
						fontSize={0}
						padding={2}
						text={`Merge ${selectedCount}`}
						disabled={selectedCount < 2}
						onClick={onMergeSelected}
						style={{ cursor: selectedCount < 2 ? 'default' : 'pointer', whiteSpace: 'nowrap' }}
					/>
					<Button
						mode="bleed"
						fontSize={0}
						padding={2}
						text="Clear"
						onClick={onClearSelection}
						style={{ cursor: 'pointer' }}
					/>
				</Flex>
			)}

			{/* Visible count */}
			{visibleCount !== fontCount && (
				<Text size={0} muted>{visibleCount} of {fontCount}</Text>
			)}
		</Flex>
	);
}
