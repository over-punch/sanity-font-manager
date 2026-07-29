// Step 3 — Upload execution with per-font progress

import React, { useEffect, useReducer, useRef, useState, useMemo } from 'react';
import { Box, Stack, Flex, Text, Card, Spinner, Badge } from '@sanity/ui';
import { WarningOutlineIcon, CheckmarkCircleIcon } from '@sanity/icons';
import { executeUploadPlan } from '../utils/executeUploadPlan';
import { executionReducer, createInitialExecutionState } from '../utils/executionReducer';
import { EXECUTION_STATUS } from '../utils/planTypes';

/** Formats elapsed seconds as "Xm Ys" or "Ys" */
const formatElapsed = (s) => {
	const m = Math.floor(s / 60);
	const sec = s % 60;
	return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
};

/**
 * Step 3 — executes the upload plan, showing per-font progress.
 * Uses a separate executionReducer to avoid re-rendering the review UI.
 */
export default function UploadStep3Execute({
	plan,
	client,
	docId,
	stylesObject,
	preferredStyleRef,
	retryTempIds,
	onComplete,
}) {
	const [execState, execDispatch] = useReducer(executionReducer, null, createInitialExecutionState);
	const [result, setResult] = useState(null);
	const [elapsedSeconds, setElapsedSeconds] = useState(0);
	const startedRef = useRef(false);
	const timerRef = useRef(null);
	const wakeLockRef = useRef(null);

	// Build the execution plan — filter to only failed fonts when retrying
	const executionPlan = useMemo(() => {
		if (!retryTempIds) return plan;
		return {
			...plan,
			fonts: Object.fromEntries(
				Object.entries(plan.fonts).filter(([tempId]) => retryTempIds.includes(tempId))
			),
		};
	}, [plan, retryTempIds]);

	const fontEntries = useMemo(() =>
		Object.values(executionPlan.fonts).filter(f => f.status !== 'error'),
		[executionPlan]
	);

	// Start execution once on mount
	useEffect(() => {
		if (startedRef.current) return;
		startedRef.current = true;

		// Start elapsed timer
		timerRef.current = setInterval(() => setElapsedSeconds(s => s + 1), 1000);

		// Request wake lock
		navigator.wakeLock?.request('screen')
			.then(lock => { wakeLockRef.current = lock; })
			.catch(() => {});

		execDispatch({ type: 'SET_EXECUTION_STATUS', status: 'uploading' });

		executeUploadPlan({
			plan: executionPlan,
			client,
			docId,
			stylesObject,
			preferredStyleRef,
			onProgress: (event) => {
				if (event.type === 'font-upload-start' || event.type === 'file-uploaded' ||
					event.type === 'css-generated' || event.type === 'metadata-generated' ||
					event.type === 'document-created') {
					if (event.fontProgress) {
						execDispatch({
							type: 'SET_FONT_EXECUTION_PROGRESS',
							tempId: event.tempId,
							progress: event.fontProgress,
						});
					}
				} else if (event.type === 'typeface-patching') {
					execDispatch({ type: 'SET_EXECUTION_STATUS', status: 'patching-typeface' });
				} else if (event.type === 'typeface-error') {
					execDispatch({ type: 'SET_EXECUTION_ERROR', error: event.error });
				}
			},
		}).then((executionResult) => {
			setResult(executionResult);
			clearInterval(timerRef.current);
			wakeLockRef.current?.release().catch(() => {});
			execDispatch({ type: 'SET_EXECUTION_STATUS', status: executionResult.success ? 'complete' : 'error' });
			onComplete(executionResult);
		}).catch((err) => {
			clearInterval(timerRef.current);
			wakeLockRef.current?.release().catch(() => {});
			execDispatch({ type: 'SET_EXECUTION_ERROR', error: err.message });
			const errorResult = {
				success: false, created: 0, updated: 0, failed: 1, skipped: 0,
				failedFonts: [{ title: 'Unknown', tempId: 'unknown', error: err.message, failedAt: 'unknown' }],
				fontRefs: [], variableRefs: [], typefacePatchError: err.message,
			};
			setResult(errorResult);
			onComplete(errorResult);
		});

		return () => {
			clearInterval(timerRef.current);
			wakeLockRef.current?.release().catch(() => {});
		};
	}, []);

	const completedCount = Object.values(execState.progress).filter(p =>
		p.status === EXECUTION_STATUS.COMPLETE || p.status === EXECUTION_STATUS.ERROR
	).length;

	// Fine-grained progress per font (0..1) across its stages, so the bar advances per FILE, not per font.
	const perFontFraction = (p) => {
		if (!p) return 0;
		switch (p.status) {
			case EXECUTION_STATUS.COMPLETE:
			case EXECUTION_STATUS.ERROR: return 1;
			case EXECUTION_STATUS.CREATING_DOCUMENT: return 0.9;
			case EXECUTION_STATUS.GENERATING_CSS:
			case EXECUTION_STATUS.GENERATING_METADATA: return 0.8;
			case EXECUTION_STATUS.UPLOADING_ASSETS: return p.filesTotal ? (p.filesComplete / p.filesTotal) * 0.7 : 0.1;
			default: return 0; // queued
		}
	};
	const totalFonts = fontEntries.length || 1;
	const doneFraction = completedCount / totalFonts;                                    // fully-completed fonts (solid)
	const fineFraction = fontEntries.reduce((s, e) => s + perFontFraction(execState.progress[e.tempId]), 0) / totalFonts; // incl. in-flight files (faded)
	const barColor = execState.status === 'error' ? 'var(--card-badge-critical-bg-color)' : 'var(--card-badge-positive-bg-color)';

	return (
		<Stack space={4}>
			{/* Global progress */}
			<Card border padding={3} radius={2}>
				<Stack space={3}>
					<Flex align="center" gap={3}>
						{execState.status === 'complete'
							? <CheckmarkCircleIcon style={{ color: '#43b649', fontSize: 20 }} />
							: execState.status === 'error'
								? <WarningOutlineIcon style={{ color: 'var(--card-badge-critical-bg-color)', fontSize: 20 }} />
								: <Spinner />
						}
						<Text size={1} weight="semibold">
							{execState.status === 'patching-typeface'
								? 'Updating typeface document...'
								: execState.status === 'complete'
									? 'Upload complete'
									: execState.status === 'error'
										? 'Upload failed'
										: `Uploading ${completedCount} of ${fontEntries.length} fonts...`
							}
						</Text>
						<Text size={1} muted style={{ marginLeft: 'auto' }}>{formatElapsed(elapsedSeconds)}</Text>
					</Flex>

					{/* Progress bar — a faded layer tracks in-flight file progress; the solid layer is fonts fully done */}
					<Box style={{ position: 'relative', height: 6, background: 'var(--card-border-color)', borderRadius: 3, overflow: 'hidden' }}>
						{/* In-progress (font-file granularity) — lower opacity, sits ahead of the solid fill */}
						<Box
							style={{
								position: 'absolute', inset: 0, transformOrigin: 'left',
								transform: `scaleX(${fineFraction})`,
								background: barColor, opacity: 0.4,
								transition: 'transform 0.3s ease-out',
							}}
						/>
						{/* Completed fonts — full opacity */}
						<Box
							style={{
								position: 'absolute', inset: 0, transformOrigin: 'left',
								transform: `scaleX(${doneFraction})`,
								background: barColor,
								transition: 'transform 0.3s ease-out',
							}}
						/>
					</Box>
				</Stack>
			</Card>

			{/* Do-not-close warning */}
			{execState.status !== 'complete' && execState.status !== 'error' && (
				<Card tone="caution" border radius={2} padding={2}>
					<Flex align="center" gap={2}>
						<WarningOutlineIcon style={{ flexShrink: 0 }} />
						<Text size={1} weight="semibold">Do not close or reload this tab</Text>
					</Flex>
				</Card>
			)}

			{/* Per-font progress list */}
			<Box style={{ maxHeight: 400, overflowY: 'auto' }}>
				<Stack space={1}>
					{fontEntries.map(entry => {
						const progress = execState.progress[entry.tempId];
						const status = progress?.status || EXECUTION_STATUS.QUEUED;

						return (
							<Card key={entry.tempId} border radius={1} padding={2}>
								<Flex align="center" gap={2}>
									<Text size={1} textOverflow="ellipsis" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
										{entry.title}
									</Text>
									<Box style={{ width: 120, flexShrink: 0, textAlign: 'right' }}>
										{status === EXECUTION_STATUS.QUEUED && (
											<Badge mode="outline" fontSize={0}>Queued</Badge>
										)}
										{status === EXECUTION_STATUS.UPLOADING_ASSETS && (
											<Flex gap={1} align="center" justify="flex-end">
												<Text size={0} muted>{progress?.currentFile || 'Uploading...'}</Text>
												<Spinner style={{ width: 12, height: 12 }} />
											</Flex>
										)}
										{(status === EXECUTION_STATUS.GENERATING_CSS || status === EXECUTION_STATUS.GENERATING_METADATA) && (
											<Flex gap={1} align="center" justify="flex-end">
												<Text size={0} muted>{status === EXECUTION_STATUS.GENERATING_CSS ? 'CSS' : 'Metadata'}</Text>
												<Spinner style={{ width: 12, height: 12 }} />
											</Flex>
										)}
										{status === EXECUTION_STATUS.CREATING_DOCUMENT && (
											<Flex gap={1} align="center" justify="flex-end">
												<Text size={0} muted>Creating doc</Text>
												<Spinner style={{ width: 12, height: 12 }} />
											</Flex>
										)}
										{status === EXECUTION_STATUS.COMPLETE && (
											<Badge tone="positive" fontSize={0}>Done</Badge>
										)}
										{status === EXECUTION_STATUS.ERROR && (
											<Badge tone="critical" fontSize={0}>Failed</Badge>
										)}
									</Box>
								</Flex>
								{status === EXECUTION_STATUS.ERROR && progress?.error && (
									<Text size={0} muted style={{ marginTop: 4 }}>{progress.error}</Text>
								)}
							</Card>
						);
					})}
				</Stack>
			</Box>

			{/* Error details */}
			{execState.error && (
				<Card tone="critical" border padding={3} radius={2}>
					<Text size={1}>{execState.error}</Text>
				</Card>
			)}
		</Stack>
	);
}
