// Merge dialog — folds several review entries for the same style into one font document

import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, Box, Card, Stack, Flex, Text, Label, Badge, Button, Radio, Select } from '@sanity/ui';
import { mergeFontEntries, findFileTypeCollisions, fileTypeOf, OUTLINE_FILE_TYPES } from '../utils/mergeFontEntries';

/** Human-readable reasons a file is left out of the merged set */
const DROP_REASONS = {
	'duplicate-format': 'duplicate format',
	superseded: 'replaced by your choice',
	'unsupported-format': 'format cannot be uploaded',
};

/**
 * Picks a sensible default primary: the entry supplying an outline file, since its metadata is
 * the one execution will re-parse. Falls back to the first entry.
 * @param {object[]} entries
 * @returns {string} tempId
 */
function defaultPrimary(entries) {
	const withOutline = entries.find(e =>
		(e.files || []).some(f => OUTLINE_FILE_TYPES.includes(fileTypeOf(f)))
	);
	return (withOutline || entries[0]).tempId;
}

/**
 * Dialog for merging two or more font plan entries into one.
 * @param {object} props
 * @param {object[]} props.entries - Entries to merge (two or more)
 * @param {Function} props.onClose - Called to dismiss without merging
 * @param {Function} props.onConfirm - Called with { tempIds, primaryTempId, fileSources }
 */
export default function MergeFontsDialog({ entries, onClose, onConfirm }) {
	const [primaryTempId, setPrimaryTempId] = useState(() => defaultPrimary(entries));
	const [fileSources, setFileSources] = useState({});

	const collisions = useMemo(() => findFileTypeCollisions(entries), [entries]);

	const { merged, report } = useMemo(
		() => mergeFontEntries(entries, { primaryTempId, fileSources }),
		[entries, primaryTempId, fileSources],
	);

	const entryTitle = useCallback(
		(tempId) => entries.find(e => e.tempId === tempId)?.title || tempId,
		[entries],
	);

	// Reviewed values that differ between entries — the merge keeps the primary's, so say so.
	const divergences = useMemo(() => {
		const primary = entries.find(e => e.tempId === primaryTempId) || entries[0];
		const out = [];
		for (const field of ['weight', 'weightName', 'style', 'subfamily']) {
			const others = entries.filter(e => e.tempId !== primary.tempId && e[field] !== primary[field]);
			if (others.length > 0) {
				out.push({ field, kept: primary[field] || '—', discarded: others.map(e => e[field] || '—') });
			}
		}
		return out;
	}, [entries, primaryTempId]);

	const handleFileSource = useCallback((type, tempId) => {
		setFileSources(prev => ({ ...prev, [type]: tempId }));
	}, []);

	const handleConfirm = useCallback(() => {
		onConfirm({ tempIds: entries.map(e => e.tempId), primaryTempId, fileSources });
	}, [entries, primaryTempId, fileSources, onConfirm]);

	return (
		<Dialog
			id="merge-fonts-dialog"
			header={<Text weight="semibold" size={2}>Merge {entries.length} entries</Text>}
			width={1}
			zOffset={1000}
			onClose={onClose}
			onClickOutside={onClose}
		>
			<Box padding={4}>
				<Stack space={4}>
					<Text size={1} muted style={{ lineHeight: 1.6 }}>
						One font document is written. The primary entry supplies the title, document ID and
						every reviewed value; the others contribute only their font files.
					</Text>

					{/* Primary selection */}
					<Stack space={2}>
						<Label size={0}>Primary entry</Label>
						{entries.map(entry => {
							const isPrimary = entry.tempId === primaryTempId;
							const types = (entry.files || []).map(fileTypeOf).filter(Boolean);
							const hasOutline = types.some(t => OUTLINE_FILE_TYPES.includes(t));
							return (
								<Card
									key={entry.tempId}
									border
									radius={2}
									padding={3}
									tone={isPrimary ? 'primary' : 'default'}
									as="label"
									style={{ cursor: 'pointer', display: 'block' }}
								>
									<Flex align="flex-start" gap={3}>
										<Radio
											checked={isPrimary}
											onChange={() => setPrimaryTempId(entry.tempId)}
											name="merge-primary"
											style={{ marginTop: 2 }}
										/>
										<Stack space={2} style={{ flex: 1, minWidth: 0 }}>
											<Flex align="center" gap={2}>
												<Text size={1} weight="semibold">{entry.title || entry.sourceFileName}</Text>
												{entry.variableFont && <Badge tone="primary" fontSize={0}>VF</Badge>}
												{hasOutline && <Badge tone="positive" fontSize={0}>metadata source</Badge>}
											</Flex>
											<Text size={0} muted style={{ fontFamily: 'monospace' }}>{entry.documentId}</Text>
											<Flex gap={1} wrap="wrap">
												{(entry.files || []).map(f => (
													<Badge key={f.name} mode="outline" fontSize={0}>{f.name}</Badge>
												))}
											</Flex>
										</Stack>
									</Flex>
								</Card>
							);
						})}
					</Stack>

					{/* Per-format choice, only where two entries supply the same format */}
					{Object.keys(collisions).length > 0 && (
						<Stack space={2}>
							<Label size={0}>Duplicate formats</Label>
							<Text size={0} muted>
								More than one entry supplies these formats. Only one file per format is uploaded.
							</Text>
							{Object.entries(collisions).map(([type, contributors]) => (
								<Flex key={type} align="center" gap={2}>
									<Text size={1} weight="semibold" style={{ width: 60 }}>{type.toUpperCase()}</Text>
									<Box style={{ flex: 1, minWidth: 0 }}>
										<Select
											value={fileSources[type] || report.files.find(f => f.type === type)?.fromTempId || ''}
											onChange={(e) => handleFileSource(type, e.target.value)}
											fontSize={1}
										>
											{contributors.map(c => (
												<option key={c.tempId} value={c.tempId}>{c.fileName}</option>
											))}
										</Select>
									</Box>
								</Flex>
							))}
						</Stack>
					)}

					{/* Result preview */}
					<Card border radius={2} padding={3} tone="transparent">
						<Stack space={3}>
							<Label size={0}>Result</Label>
							<Stack space={2}>
								<Flex gap={2}>
									<Text size={0} muted style={{ width: 90, flexShrink: 0 }}>title</Text>
									<Text size={0}>{merged.title}</Text>
								</Flex>
								<Flex gap={2}>
									<Text size={0} muted style={{ width: 90, flexShrink: 0 }}>_id</Text>
									<Text size={0} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>{merged.documentId}</Text>
								</Flex>
								<Flex gap={2}>
									<Text size={0} muted style={{ width: 90, flexShrink: 0 }}>files</Text>
									<Stack space={1} style={{ minWidth: 0 }}>
										{report.files.map(f => (
											<Text key={f.type} size={0} style={{ wordBreak: 'break-all' }}>
												{f.type.toUpperCase()}: {f.fileName}
												{f.fromTempId !== primaryTempId && (
													<span style={{ opacity: 0.6 }}> — from {entryTitle(f.fromTempId)}</span>
												)}
											</Text>
										))}
									</Stack>
								</Flex>
							</Stack>

							{report.dropped.length > 0 && (
								<Stack space={1}>
									{report.dropped.map((d, i) => (
										<Text key={`${d.fileName}-${i}`} size={0} tone="caution" style={{ wordBreak: 'break-all' }}>
											Not uploaded: {d.fileName} ({DROP_REASONS[d.reason] || d.reason})
										</Text>
									))}
								</Stack>
							)}

							{!report.hasOutlineSource && (
								<Text size={0} tone="caution" style={{ lineHeight: 1.6 }}>
									No TTF or OTF in the merged set. Metrics, character set, glyph count and variable
									instances are read from the outline file, so the document will be written without them.
								</Text>
							)}

							{report.variableFontChanged && (
								<Text size={0} tone="caution">
									Variable font flag set to {String(merged.variableFont)} to match the outline file.
								</Text>
							)}

							{divergences.map(d => (
								<Text key={d.field} size={0} muted>
									{d.field}: keeping "{d.kept}", discarding "{d.discarded.join('", "')}"
								</Text>
							))}
						</Stack>
					</Card>

					<Flex justify="flex-end" gap={2}>
						<Button mode="ghost" text="Cancel" fontSize={1} padding={3} onClick={onClose} />
						<Button
							mode="default"
							tone="primary"
							text={`Merge ${entries.length} entries`}
							fontSize={1}
							padding={3}
							onClick={handleConfirm}
						/>
					</Flex>
				</Stack>
			</Box>
		</Dialog>
	);
}
