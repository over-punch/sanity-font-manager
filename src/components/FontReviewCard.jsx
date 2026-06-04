// Per-font review row — table-style header with expandable detail panel

import React, { useState, useCallback, useEffect, useMemo, memo } from 'react';
import { Card, Stack, Flex, Box, Text, TextInput, Badge, Button, Select, Tooltip, Label } from '@sanity/ui';
import { ChevronDownIcon, ChevronRightIcon, TrashIcon, ResetIcon, InfoOutlineIcon } from '@sanity/icons';
import { FONT_STATUS, RECOMMENDATION } from '../utils/planTypes';
import ExistingDocumentResolver from './ExistingDocumentResolver';

/** Standard file types shown in the files row */
const STANDARD_TYPES = ['ttf', 'otf', 'woff', 'woff2'];
/** Extended file types shown when expanded */
const EXTENDED_TYPES = ['eot', 'svg', 'css', 'woff2_subset', 'woff2_web'];

/**
 * Collapsible review card for a single font in the upload plan.
 * Table-style header row with weight/style/files/action columns.
 */
const FontReviewCard = memo(function FontReviewCard({ entry, dispatch, allExpanded, typefaceTitle, price }) {
	const [expanded, setExpanded] = useState(false);
	const [showAllFileTypes, setShowAllFileTypes] = useState(false);
	const [showDocPreview, setShowDocPreview] = useState(false);

	// Sync with allExpanded toggle from BulkActions
	useEffect(() => {
		setExpanded(allExpanded);
	}, [allExpanded]);

	// Local state for typing — dispatches on blur
	const [localTitle, setLocalTitle] = useState(entry.title);
	const [localWeight, setLocalWeight] = useState(String(entry.weight));
	const [localWeightName, setLocalWeightName] = useState(entry.weightName);
	const [localSubfamily, setLocalSubfamily] = useState(entry.subfamily);

	const [localDocId, setLocalDocId] = useState(entry.documentId);

	const isError = entry.status === FONT_STATUS.ERROR;
	const hasConflict = entry._idConflict;
	const resolution = entry.decisions?.existingDocument;
	const isUpdate = resolution?.userChoice === 'update' ||
		(!resolution?.userChoice && (resolution?.recommendation === RECOMMENDATION.USE_EXACT || resolution?.recommendation === RECOMMENDATION.USE_CANDIDATE));

	// Document ID is editable when user chose "create new" on a font with an existing match
	const isCreateNewOverride = resolution?.userChoice === 'create' &&
		(resolution?.exact || resolution?.candidates?.length > 0);
	const docIdEditable = isCreateNewOverride || hasConflict;

	// Detect if user has overridden any suggestions
	const hasUserOverrides = useMemo(() => {
		const d = entry.decisions;
		if (!d) return false;
		return (
			d.title?.userOverride != null ||
			d.weight?.userOverride != null ||
			d.weightName?.userOverride != null ||
			d.style?.userOverride != null ||
			d.subfamily?.userOverride != null ||
			d.documentId?.userOverride != null
		);
	}, [entry.decisions]);

	// Map of which file extensions are present
	const fileExtMap = useMemo(() => {
		const map = {};
		(entry.files || []).forEach(f => {
			const ext = f.name?.split('.').pop()?.toLowerCase();
			if (ext) map[ext] = f.name;
		});
		return map;
	}, [entry.files]);

	const fileCount = entry.files?.length || 0;
	const cardTone = isError ? 'critical' : hasConflict ? 'caution' : 'default';

	const handleTitleBlur = useCallback(() => {
		if (localTitle !== entry.title) {
			dispatch({ type: 'SET_FONT_TITLE', tempId: entry.tempId, title: localTitle });
		}
	}, [localTitle, entry.title, entry.tempId, dispatch]);

	const handleDocIdBlur = useCallback(() => {
		if (localDocId !== entry.documentId) {
			dispatch({ type: 'SET_FONT_DOCUMENT_ID', tempId: entry.tempId, documentId: localDocId });
		}
	}, [localDocId, entry.documentId, entry.tempId, dispatch]);

	const handleWeightBlur = useCallback(() => {
		const num = Number(localWeight);
		if (!isNaN(num) && num !== entry.weight) {
			dispatch({ type: 'SET_FONT_WEIGHT', tempId: entry.tempId, weight: num });
		}
	}, [localWeight, entry.weight, entry.tempId, dispatch]);

	const handleWeightNameBlur = useCallback(() => {
		if (localWeightName !== entry.weightName) {
			dispatch({ type: 'SET_FONT_WEIGHT_NAME', tempId: entry.tempId, weightName: localWeightName });
		}
	}, [localWeightName, entry.weightName, entry.tempId, dispatch]);

	const handleStyleChange = useCallback((e) => {
		dispatch({ type: 'SET_FONT_STYLE', tempId: entry.tempId, style: e.target.value });
	}, [entry.tempId, dispatch]);

	const handleSubfamilyBlur = useCallback(() => {
		if (localSubfamily !== entry.subfamily) {
			dispatch({ type: 'SET_FONT_SUBFAMILY', tempId: entry.tempId, subfamily: localSubfamily });
		}
	}, [localSubfamily, entry.subfamily, entry.tempId, dispatch]);

	const handleReset = useCallback(() => {
		dispatch({ type: 'RESET_FONT_TO_SUGGESTIONS', tempId: entry.tempId });
		setLocalTitle(entry.decisions.title.processed);
		setLocalDocId(entry.decisions.documentId.generated);
		setLocalWeight(String(entry.decisions.weight.detected));
		setLocalWeightName(entry.decisions.weightName.detected);
		setLocalSubfamily(entry.decisions.subfamily.detected || 'Regular');
	}, [entry, dispatch]);

	const handleRemove = useCallback(() => {
		dispatch({ type: 'REMOVE_FONT', tempId: entry.tempId });
	}, [entry.tempId, dispatch]);

	/** Format source string — converts nameId references to readable format, appends user override if present */
	const formatSource = (decision) => {
		if (!decision) return null;
		let src = decision.source || '';
		// Format name table references: nameId1-familyName → nameId1 (familyName)
		src = src.replace(/nameId(\d+)-(\w+)/g, 'nameId$1 ($2)');
		src = src.replace(/-/g, ' ').replace('fontkit ', '');
		// Special case: default-empty for subfamily
		if (src === 'default empty' && decision.detected === '') {
			src = 'empty — defaults to "Regular"';
		}
		const reason = decision.reason ? ` (${decision.reason})` : '';
		const override = decision.userOverride != null ? ' (user override)' : '';
		return `Source: ${src}${reason}${override}`;
	};

	return (
		<Card border radius={2} tone={cardTone} style={{ marginBottom: -1 }}>
			{/* Header row — table-style columns */}
			<Box
				as="button"
				onClick={() => !isError && setExpanded(v => !v)}
				style={{
					width: '100%',
					background: expanded ? 'var(--card-muted-bg-color)' : 'none',
					border: 'none',
					cursor: isError ? 'default' : 'pointer',
					textAlign: 'left',
					padding: 0,
					transition: 'background 0.1s ease',
				}}
				onMouseEnter={(e) => { if (!isError && !expanded) e.currentTarget.style.background = 'var(--card-muted-bg-color)'; }}
				onMouseLeave={(e) => { if (!expanded) e.currentTarget.style.background = 'none'; }}
			>
				<Flex align="center" gap={2} paddingX={2} paddingY={2}>
					<Box style={{ width: 20, flexShrink: 0 }}>
						{!isError && (expanded ? <ChevronDownIcon /> : <ChevronRightIcon />)}
					</Box>
					<Box style={{ flex: 1, whiteSpace: 'nowrap',}}>
						<Text size={1} weight="semibold"  style={{ whiteSpace: 'nowrap'  }}>
							{entry.title || entry.sourceFileName}
							{entry.variableFont && <Badge tone="primary" fontSize={0} style={{ marginLeft: 6 }}>VF</Badge>}
							{hasConflict && <Badge tone="caution" fontSize={0} style={{ marginLeft: 6 }}>ID Conflict</Badge>}
						</Text>
					</Box>
					<Text size={0} style={{ width: 50, textAlign: 'center', flexShrink: 0 }}>{entry.weight}</Text>
					<Text size={0} style={{ width: 50, textAlign: 'center', flexShrink: 0 }}>{entry.style}</Text>
					<Text size={0} style={{ width: 40, textAlign: 'center', flexShrink: 0 }}>{fileCount}</Text>
					<Box style={{ width: 55, textAlign: 'center', flexShrink: 0 }}>
						<Badge tone={isError ? 'critical' : isUpdate ? 'caution' : 'positive'} fontSize={0}>
							{isError ? 'Error' : isUpdate ? 'Update' : 'Create'}
						</Badge>
					</Box>
				</Flex>
			</Box>

			{/* Error message */}
			{isError && (
				<Box paddingX={2} paddingBottom={2}>
					<Flex justify="space-between" align="center">
						<Text size={0} muted>{entry.error}</Text>
						<Button mode="bleed" tone="critical" icon={TrashIcon} padding={1} onClick={handleRemove} />
					</Flex>
				</Box>
			)}

			{/* Expanded detail panel */}
			{expanded && !isError && (
				<Box padding={3} style={{ borderTop: '1px solid var(--card-border-color)', background: 'var(--card-muted-bg-color)' }}>
					<Stack space={4}>
						{/* Files — standard types with grey for missing, expandable for extended */}
						<Stack space={2}>
							<Flex align="center" gap={2}>
								<Label size={0}>Files ({fileCount})</Label>
								<Button
									mode="bleed"
									fontSize={0}
									padding={1}
									text={showAllFileTypes ? 'Hide extended types' : 'Show all types'}
									onClick={() => setShowAllFileTypes(v => !v)}
									style={{ cursor: 'pointer' }}
								/>
							</Flex>
							<Flex gap={1} wrap="wrap">
								{STANDARD_TYPES.map(ext => (
									<Badge
										key={ext}
										fontSize={0}
										tone={fileExtMap[ext] ? 'primary' : 'default'}
										mode={fileExtMap[ext] ? 'default' : 'outline'}
										style={{ opacity: fileExtMap[ext] ? 1 : 0.35 }}
									>
										{ext.toUpperCase()}{fileExtMap[ext] ? `: ${fileExtMap[ext]}` : ''}
									</Badge>
								))}
								{showAllFileTypes && EXTENDED_TYPES.map(ext => (
									<Badge
										key={ext}
										fontSize={0}
										tone={fileExtMap[ext] ? 'primary' : 'default'}
										mode={fileExtMap[ext] ? 'default' : 'outline'}
										style={{ opacity: fileExtMap[ext] ? 1 : 0.35 }}
									>
										{ext.toUpperCase()}{fileExtMap[ext] ? `: ${fileExtMap[ext]}` : ''}
									</Badge>
								))}
							</Flex>
						</Stack>

						{/* Title */}
						<Stack space={2}>
							<Label size={0}>Font Title</Label>
							<TextInput
								value={localTitle}
								onChange={(e) => setLocalTitle(e.target.value)}
								onBlur={handleTitleBlur}
								fontSize={1}
							/>
							<Text size={0} muted>{formatSource(entry.decisions?.title)}</Text>
							{entry.decisions?.title?.alternatives?.length > 0 && (
								<Flex gap={1} wrap="wrap">
									{entry.decisions.title.alternatives.filter(a => a.value).map((alt, i) => (
										<Tooltip key={i} content={<Box padding={1}><Text size={0}>{alt.source.replace(/nameId(\d+)-(\w+)/g, 'nameId$1 ($2)')}</Text></Box>} portal>
											<Badge
												mode="outline"
												fontSize={0}
												style={{ cursor: 'pointer' }}
												onClick={() => {
													setLocalTitle(alt.value);
													dispatch({ type: 'SET_FONT_TITLE', tempId: entry.tempId, title: alt.value, source: alt.source });
												}}
											>
												{alt.value.length > 30 ? alt.value.slice(0, 30) + '...' : alt.value}
											</Badge>
										</Tooltip>
									))}
								</Flex>
							)}
						</Stack>

						{/* Document ID */}
						<Stack space={2}>
							<Flex align="center" gap={1}>
								<Label size={0}>Document ID</Label>
								{!docIdEditable && (
									<Tooltip
										content={<Box padding={2} style={{ maxWidth: 260 }}><Text size={1} style={{ lineHeight: 1.6 }}>Document IDs must be unique. This field is auto-derived from the font title. It becomes editable when you choose "Create new instead" on a font with an existing match, or when there is a duplicate ID conflict.</Text></Box>}
										placement="top"
										portal
									>
										<InfoOutlineIcon style={{ opacity: 0.4, fontSize: 12 }} />
									</Tooltip>
								)}
							</Flex>
							<TextInput
								value={docIdEditable ? localDocId : entry.documentId}
								onChange={docIdEditable ? (e) => setLocalDocId(e.target.value) : undefined}
								onBlur={docIdEditable ? handleDocIdBlur : undefined}
								readOnly={!docIdEditable}
								fontSize={1}
								style={{ fontFamily: 'monospace', opacity: docIdEditable ? 1 : 0.7 }}
							/>
							{hasConflict && (
								<Text size={0} tone="caution">This ID conflicts with another font in this batch — edit to make unique</Text>
							)}
							{isCreateNewOverride && !hasConflict && (
								<Text size={0} tone="caution">Creating new document — edit the ID to avoid overwriting the existing document</Text>
							)}
							{!docIdEditable && (
								<Text size={0} muted>Auto-derived from font title</Text>
							)}
						</Stack>

						{/* Weight + Weight Name row */}
						<Flex gap={3}>
							<Box style={{ flex: 1 }}>
								<Stack space={2}>
									<Label size={0}>Weight</Label>
									<TextInput
										type="number"
										value={localWeight}
										onChange={(e) => setLocalWeight(e.target.value)}
										onBlur={handleWeightBlur}
										fontSize={1}
									/>
									{entry.decisions?.weight && (
										<Text size={0} muted>{formatSource(entry.decisions.weight)}</Text>
									)}
								</Stack>
							</Box>
							<Box style={{ flex: 1 }}>
								<Stack space={2}>
									<Label size={0}>Weight Name</Label>
									<TextInput
										value={localWeightName}
										onChange={(e) => setLocalWeightName(e.target.value)}
										onBlur={handleWeightNameBlur}
										fontSize={1}
									/>
									{entry.decisions?.weightName && (
										<Text size={0} muted>{formatSource(entry.decisions.weightName)}</Text>
									)}
								</Stack>
							</Box>
						</Flex>

						{/* Style + Subfamily row */}
						<Flex gap={3}>
							<Box style={{ flex: 1 }}>
								<Stack space={2}>
									<Label size={0}>Style</Label>
									<Select value={entry.style} onChange={handleStyleChange} fontSize={1}>
										<option value="Regular">Regular</option>
										<option value="Italic">Italic</option>
									</Select>
									{entry.decisions?.style && (
										<Text size={0} muted>{formatSource(entry.decisions.style)}</Text>
									)}
								</Stack>
							</Box>
							<Box style={{ flex: 1 }}>
								<Stack space={2}>
									<Label size={0}>Subfamily</Label>
									<TextInput
										value={localSubfamily}
										onChange={(e) => setLocalSubfamily(e.target.value)}
										onBlur={handleSubfamilyBlur}
										fontSize={1}
									/>
									{entry.decisions?.subfamily && (
										<Text size={0} muted>{formatSource(entry.decisions.subfamily)}</Text>
									)}
								</Stack>
							</Box>
						</Flex>

						{/* VF axes info */}
						{entry.variableFont && entry.variationAxes && (
							<Stack space={2}>
								<Label size={0}>Variable Font Axes</Label>
								<Flex gap={1} wrap="wrap">
									{Object.entries(entry.variationAxes).map(([tag, axis]) => (
										<Badge key={tag} mode="outline" fontSize={0}>
											{tag} {axis.min}–{axis.max}
										</Badge>
									))}
								</Flex>
								{entry.decisions?.weight?.userOverride != null && entry.variationAxes?.wght && (
									(entry.weight < entry.variationAxes.wght.min || entry.weight > entry.variationAxes.wght.max) && (
										<Text size={0} tone="caution">
											Weight {entry.weight} is outside the wght axis range ({entry.variationAxes.wght.min}–{entry.variationAxes.wght.max})
										</Text>
									)
								)}
							</Stack>
						)}

						{/* Existing document resolution */}
						<ExistingDocumentResolver
							decision={entry.decisions?.existingDocument}
							tempId={entry.tempId}
							dispatch={dispatch}
						/>

						{/* Document Preview — expandable view of all fields that will be written */}
						<Stack space={2}>
							<Button
								mode="bleed"
								fontSize={0}
								padding={1}
								text={showDocPreview ? 'Hide document preview' : 'Show document preview'}
								onClick={() => setShowDocPreview(v => !v)}
								style={{ cursor: 'pointer', alignSelf: 'flex-start' }}
							/>
							{showDocPreview && (
								<Card border padding={3} radius={1} style={{ fontFamily: 'monospace', fontSize: 12 }}>
									<Stack space={2}>
										{[
											['_id', entry.documentId],
											['_type', 'font'],
											['title', entry.title],
											['slug', entry.documentId],
											['typefaceName', typefaceTitle || '—'],
											['weightName', entry.weightName || '—'],
											['weight', entry.weight],
											['style', entry.style],
											['subfamily', entry.subfamily || '—'],
											['variableFont', String(entry.variableFont)],
											['price', price ?? '—'],
											['sell', price > 0 ? 'true' : 'false'],
											['normalWeight', 'true'],
											['files', (entry.files || []).map(f => f.name).join(', ') || '—'],
										].map(([key, value]) => (
											<Flex key={key} gap={2}>
												<Text size={0} muted style={{ width: 120, flexShrink: 0 }}>{key}</Text>
												<Text size={0} style={{ wordBreak: 'break-all' }}>{String(value)}</Text>
											</Flex>
										))}
									</Stack>
								</Card>
							)}
						</Stack>

						{/* Actions — only show reset if user has overridden suggestions */}
						<Flex justify="flex-end" gap={2}>
							{hasUserOverrides && (
								<Button
									mode="ghost"
									tone="default"
									icon={ResetIcon}
									text="Reset to Suggestions"
									fontSize={1}
									padding={2}
									onClick={handleReset}
								/>
							)}
							<Button
								mode="ghost"
								tone="critical"
								icon={TrashIcon}
								text="Remove"
								fontSize={1}
								padding={2}
								onClick={handleRemove}
							/>
						</Flex>
					</Stack>
				</Box>
			)}
		</Card>
	);
});

export default FontReviewCard;
