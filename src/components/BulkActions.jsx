// Bulk actions bar — expand/collapse all, search, filter with counts

import React, { useMemo } from 'react';
import { Flex, Box, Button, TextInput, Select, Text, Label } from '@sanity/ui';
import { SearchIcon } from '@sanity/icons';
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
		const italicCount = fontEntries.filter(f => f.style === 'Italic' && f.status !== FONT_STATUS.ERROR).length;
		const regularCount = fontEntries.filter(f => f.style === 'Regular' && f.status !== FONT_STATUS.ERROR).length;

		// Subfamily counts
		const subfamilyCounts = {};
		fontEntries.forEach(f => {
			if (f.status === FONT_STATUS.ERROR) return;
			const sf = f.subfamily || 'Regular';
			subfamilyCounts[sf] = (subfamilyCounts[sf] || 0) + 1;
		});

		return { createCount, updateCount, errorCount, conflictCount, italicCount, regularCount, subfamilyCounts };
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
					{subfamilies.length > 1 && subfamilies.map(sf => (
						<option key={sf} value={`sf:${sf}`}>{sf} ({filterCounts.subfamilyCounts[sf]})</option>
					))}
				</Select>
			</Flex>

			{/* Visible count */}
			{visibleCount !== fontCount && (
				<Text size={0} muted>{visibleCount} of {fontCount}</Text>
			)}
		</Flex>
	);
}
