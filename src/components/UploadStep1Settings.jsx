// Step 1 — File upload: drag-and-drop zone, file list table, type breakdown with mismatch detection

import React, { useState, useCallback, useRef, useMemo } from 'react';
import { Box, Flex, Stack, Text, Button, Card, Badge } from '@sanity/ui';
import { UploadIcon, TrashIcon } from '@sanity/icons';

/** Accepted font file extensions */
const ACCEPTED_EXTENSIONS = ['ttf', 'otf', 'woff', 'woff2', 'eot', 'svg'];

/** Sort order: TTF/OTF before web formats so metadata is available for webfont fallback */
const TYPE_ORDER = ['ttf', 'otf', 'eot', 'svg', 'woff', 'woff2'];

/** Returns only files with accepted font extensions */
const filterFontFiles = (files) =>
	Array.from(files).filter(f => ACCEPTED_EXTENSIONS.includes(f.name.split('.').pop().toLowerCase()));

/** Sorts font files so TTF/OTF are processed before web formats */
const sortFilesByType = (files) =>
	Array.from(files).sort((a, b) => {
		const aIdx = TYPE_ORDER.indexOf(a.name.split('.').pop().toLowerCase());
		const bIdx = TYPE_ORDER.indexOf(b.name.split('.').pop().toLowerCase());
		if (aIdx === bIdx) return a.name.localeCompare(b.name);
		return aIdx - bIdx;
	});

/**
 * Step 1 component — file selection only. Settings are in Step 2.
 *
 * @param {object} props
 * @param {object} props.settings - Current plan settings
 * @param {function} props.onStartProcessing - Called with (sortedFiles, settings) when user clicks "Process Files"
 */
export default function UploadStep1Settings({ settings, onStartProcessing }) {
	const [pendingFiles, setPendingFiles] = useState([]);
	const [isDragging, setIsDragging] = useState(false);
	const [filterType, setFilterType] = useState(null);
	const fileInputRef = useRef(null);

	const handleFileSelect = useCallback((e) => {
		const files = filterFontFiles(e.target.files);
		if (files.length > 0) setPendingFiles(prev => [...prev, ...files]);
		e.target.value = '';
	}, []);

	const handleRemoveFile = useCallback((file) => {
		setPendingFiles(prev => prev.filter(f => f !== file));
	}, []);

	const handleDragEnter = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
	const handleDragOver = useCallback((e) => { e.preventDefault(); }, []);
	const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
	const handleDrop = useCallback((e) => {
		e.preventDefault();
		setIsDragging(false);
		const files = filterFontFiles(e.dataTransfer.files);
		if (files.length > 0) setPendingFiles(prev => [...prev, ...files]);
	}, []);

	const handleProcess = useCallback(() => {
		const sorted = sortFilesByType(pendingFiles);
		onStartProcessing(sorted, settings);
	}, [pendingFiles, settings, onStartProcessing]);

	/** Count files by extension and detect outliers (types whose count differs from the majority) */
	const typeBreakdown = useMemo(() => {
		const counts = {};
		pendingFiles.forEach(f => {
			const ext = f.name.split('.').pop().toLowerCase();
			counts[ext] = (counts[ext] || 0) + 1;
		});

		const values = Object.values(counts);
		if (values.length <= 1) return { counts, modeCount: 0, outlierExts: new Set() };

		// Find the mode (most frequent count) — types matching the mode are normal, others are outliers
		const freq = {};
		values.forEach(v => { freq[v] = (freq[v] || 0) + 1; });
		const modeCount = Number(Object.entries(freq).sort((a, b) => b[1] - a[1])[0][0]);

		const outlierExts = new Set();
		Object.entries(counts).forEach(([ext, count]) => {
			if (count !== modeCount) outlierExts.add(ext);
		});

		return { counts, modeCount, outlierExts };
	}, [pendingFiles]);

	/** Files filtered by the active type filter — displayed in upload order */
	const displayedFiles = useMemo(() => {
		if (!filterType) return pendingFiles;
		return pendingFiles.filter(f => f.name.split('.').pop().toLowerCase() === filterType);
	}, [pendingFiles, filterType]);

	const dropZoneStyle = {
		border: `2px dashed ${isDragging ? 'var(--card-focus-ring-color)' : 'var(--card-border-color)'}`,
		borderRadius: 4,
		padding: pendingFiles.length > 0 ? '10px 16px' : '28px 16px',
		textAlign: 'center',
		background: isDragging ? 'rgba(100, 153, 255, 0.06)' : 'transparent',
		transition: 'border-color 0.12s, background 0.12s',
	};

	return (
		<Stack space={4}>
			{/* Drop zone */}
			<Box
				onDragEnter={handleDragEnter}
				onDragOver={handleDragOver}
				onDragLeave={handleDragLeave}
				onDrop={handleDrop}
				style={dropZoneStyle}
			>
				<input
					ref={fileInputRef}
					type="file"
					multiple
					hidden
					accept=".ttf,.otf,.woff,.woff2,.eot,.svg"
					onChange={handleFileSelect}
				/>
				{pendingFiles.length === 0 ? (
					<Stack space={3}>
						<Text size={1} muted>{isDragging ? 'Release to add files' : 'Drop font files here'}</Text>
						<Flex justify="center">
							<Button
								mode="ghost"
								tone="primary"
								fontSize={1}
								padding={2}
								text="Browse files"
								onClick={() => fileInputRef.current?.click()}
							/>
						</Flex>
					</Stack>
				) : (
					<Flex align="center" justify="center" gap={2}>
						<Text size={1} muted>{isDragging ? 'Release to add' : 'Drop more files or'}</Text>
						<Button
							mode="bleed"
							tone="primary"
							fontSize={1}
							padding={1}
							text="browse"
							onClick={() => fileInputRef.current?.click()}
						/>
					</Flex>
				)}
			</Box>

			{/* File breakdown + list */}
			{pendingFiles.length > 0 && (
				<Stack space={3}>
					{/* Summary: total + type breakdown */}
					<Flex align="center" justify="space-between">
						<Flex align="center" gap={2}>
							<Text size={1} weight="semibold">
								{filterType
									? `${displayedFiles.length} of ${pendingFiles.length} files (${filterType.toUpperCase()})`
									: `${pendingFiles.length} file${pendingFiles.length === 1 ? '' : 's'}`
								}
							</Text>
							<Flex gap={1}>
								{TYPE_ORDER.filter(ext => typeBreakdown.counts[ext]).map(ext => {
									const count = typeBreakdown.counts[ext];
									const isOutlier = typeBreakdown.outlierExts.has(ext);
									const isActive = filterType === ext;
									return (
										<Badge
											key={ext}
											tone={isOutlier ? 'critical' : isActive ? 'primary' : 'default'}
											mode={isActive ? 'default' : isOutlier ? 'default' : 'outline'}
											fontSize={0}
											style={{ cursor: 'pointer' }}
											onClick={() => setFilterType(isActive ? null : ext)}
										>
											{count} {ext.toUpperCase()}
										</Badge>
									);
								})}
								{filterType && (
									<Badge
										mode="outline"
										fontSize={0}
										style={{ cursor: 'pointer' }}
										onClick={() => setFilterType(null)}
									>
										Clear filter
									</Badge>
								)}
							</Flex>
						</Flex>
						<Button
							mode="bleed"
							tone="default"
							fontSize={1}
							padding={1}
							text="Clear all"
							onClick={() => setPendingFiles([])}
						/>
					</Flex>

					{/* File table */}
					<Box style={{ maxHeight: 350, overflowY: 'auto' }}>
						{/* Table header */}
						<Flex
							align="center"
							gap={2}
							paddingX={2}
							paddingY={1}
							style={{ borderBottom: '1px solid var(--card-border-color)' }}
						>
							<Text size={0} weight="semibold" muted style={{ width: 56, flexShrink: 0 }}>Type</Text>
							<Text size={0} weight="semibold" muted style={{ flex: 1 }}>File Name</Text>
							<Box style={{ width: 32 }} />
						</Flex>
						<Stack space={0}>
							{displayedFiles.map((file, i) => {
								const ext = file.name.split('.').pop().toLowerCase();
								return (
									<Flex
										key={`${file.name}-${file.size}-${i}`}
										align="center"
										gap={2}
										paddingX={2}
										paddingY={2}
										style={{
											borderBottom: '1px solid var(--card-border-color)',
										}}
									>
										<Badge
											tone="primary"
											mode="outline"
											fontSize={0}
											style={{ width: 56, flexShrink: 0, textAlign: 'center' }}
										>
											{ext.toUpperCase()}
										</Badge>
										<Text size={1} style={{ flex: 1 }}>
											{file.name}
										</Text>
										<Button
											mode="bleed"
											tone="critical"
											icon={TrashIcon}
											padding={1}
											onClick={() => handleRemoveFile(file)}
											style={{ flexShrink: 0 }}
										/>
									</Flex>
								);
							})}
						</Stack>
					</Box>
				</Stack>
			)}

			{/* Process button */}
			{pendingFiles.length > 0 && (
				<Button
					mode="default"
					tone="primary"
					icon={UploadIcon}
					text={`Process ${pendingFiles.length} File${pendingFiles.length === 1 ? '' : 's'}`}
					style={{ width: '100%' }}
					fontSize={2}
					padding={4}
					onClick={handleProcess}
				/>
			)}
		</Stack>
	);
}
