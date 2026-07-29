// Post-upload summary — results display with retry for failed fonts and typeface patch

import React, { useState, useCallback } from 'react';
import { Stack, Flex, Text, Card, Badge, Button, Box, Spinner } from '@sanity/ui';
import { CheckmarkCircleIcon, WarningOutlineIcon, ResetIcon } from '@sanity/icons';
import { updateTypefaceDocument } from '../utils/updateTypefaceDocument';

/** Cartoon-firework colours */
const FW_COLORS = ['#ff5252', '#ffca28', '#66bb6a', '#42a5f5', '#ab47bc', '#ff7043', '#26c6da', '#ec407a'];
/** Burst positions/timing across the celebration band */
const FW_BURSTS = [
	{ left: '18%', top: '58%', delay: 0 },
	{ left: '72%', top: '42%', delay: 0.35 },
	{ left: '46%', top: '30%', delay: 0.7 },
	{ left: '86%', top: '66%', delay: 1.05 },
	{ left: '32%', top: '72%', delay: 1.4 },
];
const FW_PARTICLES = 14;
const FW_CSS = `
@keyframes fwShoot {
	0%   { transform: rotate(var(--a)) translateY(0) scale(1);   opacity: 0; }
	12%  { opacity: 1; }
	100% { transform: rotate(var(--a)) translateY(-52px) scale(0.35); opacity: 0; }
}
@keyframes fwFlash { 0% { transform: scale(0.2); opacity: 0.9; } 60%, 100% { transform: scale(1.4); opacity: 0; } }
.fw-burst { position: absolute; width: 0; height: 0; }
.fw-flash { position: absolute; top: -9px; left: -9px; width: 18px; height: 18px; border-radius: 50%; background: radial-gradient(circle, #fff, rgba(255,255,255,0)); animation: fwFlash 1.7s ease-out 3; animation-delay: inherit; }
.fw-p { position: absolute; top: 0; left: 0; width: 7px; height: 7px; margin: -3.5px; border-radius: 50%; animation: fwShoot 1.7s ease-out 3; animation-delay: inherit; }
@media (prefers-reduced-motion: reduce) { .fw-burst { display: none; } }
`;

/** Self-contained cartoon fireworks overlay (pure CSS, no deps). Sits behind content, non-interactive. */
function Fireworks() {
	return (
		<Box aria-hidden="true" style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0, borderRadius: 6 }}>
			<style>{FW_CSS}</style>
			{FW_BURSTS.map((b, bi) => (
				<div key={bi} className="fw-burst" style={{ left: b.left, top: b.top, animationDelay: `${b.delay}s` }}>
					<span className="fw-flash" style={{ animationDelay: `${b.delay}s` }} />
					{Array.from({ length: FW_PARTICLES }).map((_, pi) => (
						<span
							key={pi}
							className="fw-p"
							style={{ '--a': `${(360 / FW_PARTICLES) * pi}deg`, background: FW_COLORS[(bi + pi) % FW_COLORS.length], animationDelay: `${b.delay}s` }}
						/>
					))}
				</div>
			))}
		</Box>
	);
}

/**
 * Post-upload summary — shows execution results with retry options.
 */
export default function UploadSummary({
	plan,
	result,
	onClose,
	onRetry,
	client,
	docId,
	stylesObject,
	preferredStyleRef,
}) {
	const [retryingPatch, setRetryingPatch] = useState(false);
	const [patchRetryResult, setPatchRetryResult] = useState(null);

	const hasFailedFonts = result?.failedFonts?.length > 0;
	const hasTypefacePatchError = result?.typefacePatchError && !patchRetryResult?.success;
	const allSuccess = result?.success && !hasTypefacePatchError;

	/** Retry the typeface document patch only */
	const handleRetryTypefacePatch = useCallback(async () => {
		if (!result || !client || !docId) return;
		setRetryingPatch(true);
		setPatchRetryResult(null);

		try {
			const subfamilies = {};
			const uniqueSubfamilies = new Set();
			for (const entry of Object.values(plan.fonts)) {
				if (entry.status === 'error') continue;
				subfamilies[entry.documentId] = entry.subfamily;
				if (entry.subfamily) uniqueSubfamilies.add(entry.subfamily);
			}

			await updateTypefaceDocument(
				docId,
				result.fontRefs || [],
				result.variableRefs || [],
				subfamilies,
				[...uniqueSubfamilies],
				stylesObject?.subfamilies || [],
				preferredStyleRef || {},
				{ weight: -100, style: 'Italic', _ref: result.fontRefs?.[0]?._ref || '' },
				stylesObject || {},
				client,
				() => {},
				() => {},
			);

			setPatchRetryResult({ success: true });
		} catch (err) {
			console.error('Typeface patch retry failed:', err);
			setPatchRetryResult({ success: false, error: err.message });
		}

		setRetryingPatch(false);
	}, [result, client, docId, plan, stylesObject, preferredStyleRef]);

	return (
		<Stack space={4}>
			{/* Header — celebratory with a cartoon-fireworks overlay on full success */}
			<Box style={{ position: 'relative', overflow: 'hidden', borderRadius: 6, padding: allSuccess ? '22px 12px' : 0 }}>
				{allSuccess && <Fireworks />}
				<Flex align="center" justify={allSuccess ? 'center' : 'flex-start'} gap={3} ref={(el) => el?.focus?.()} tabIndex={-1} style={{ position: 'relative', zIndex: 1 }}>
					{allSuccess ? (
						<CheckmarkCircleIcon style={{ color: '#43b649', fontSize: 34 }} />
					) : (
						<WarningOutlineIcon style={{ color: '#f03e2f', fontSize: 28 }} />
					)}
					<Text size={allSuccess ? 3 : 2} weight="semibold">
						{allSuccess ? 'Upload complete' : 'Upload Completed with Issues'}
					</Text>
				</Flex>
			</Box>

			{/* Stats */}
			{result && (
				<Card border padding={4} radius={2}>
					<Stack space={3}>
						<Flex gap={2} wrap="wrap">
							{result.created > 0 && (
								<Badge tone="positive" fontSize={1}>
									{result.created} created
								</Badge>
							)}
							{result.updated > 0 && (
								<Badge tone="caution" fontSize={1}>
									{result.updated} updated
								</Badge>
							)}
							{result.failed > 0 && (
								<Badge tone="critical" fontSize={1}>
									{result.failed} failed
								</Badge>
							)}
							{result.skipped > 0 && (
								<Badge mode="outline" fontSize={1}>
									{result.skipped} skipped
								</Badge>
							)}
						</Flex>
					</Stack>
				</Card>
			)}

			{/* Failed fonts */}
			{hasFailedFonts && (
				<Stack space={3}>
					<Flex align="center" justify="space-between">
						<Flex align="center" gap={2}>
							<Text size={1} weight="semibold">Failed Fonts</Text>
							<Badge tone="critical" fontSize={0}>{result.failedFonts.length}</Badge>
						</Flex>
						<Button
							mode="ghost"
							tone="primary"
							icon={ResetIcon}
							text="Retry Failed"
							fontSize={1}
							padding={2}
							onClick={() => onRetry(result.failedFonts.map(f => f.tempId).filter(Boolean))}
						/>
					</Flex>
					<Stack space={2}>
						{result.failedFonts.map((f, i) => (
							<Card key={i} tone="critical" border padding={3} radius={2}>
								<Stack space={2}>
									<Flex align="center" gap={2}>
										<Text size={1} weight="semibold">{f.title}</Text>
										{f.failedAt && f.failedAt !== 'unknown' && (
											<Badge tone="critical" fontSize={0} mode="outline">Failed at: {f.failedAt}</Badge>
										)}
									</Flex>
									<Text size={1}>{f.error}</Text>
								</Stack>
							</Card>
						))}
					</Stack>
				</Stack>
			)}

			{/* Typeface patch error */}
			{hasTypefacePatchError && (
				<Card tone="caution" border padding={4} radius={2}>
					<Stack space={3}>
						<Text size={1} weight="semibold">Typeface Document Not Updated</Text>
						<Text size={1}>
							{result.created + result.updated} font document{result.created + result.updated === 1 ? '' : 's'} created/updated successfully, but the typeface document could not be patched to reference them.
						</Text>
						<Text size={1} muted>{result.typefacePatchError}</Text>
						<Flex gap={2}>
							<Button
								mode="default"
								tone="primary"
								icon={retryingPatch ? undefined : ResetIcon}
								text={retryingPatch ? 'Retrying...' : 'Retry Typeface Patch'}
								disabled={retryingPatch}
								onClick={handleRetryTypefacePatch}
							/>
							{retryingPatch && <Spinner />}
						</Flex>
					</Stack>
				</Card>
			)}

			{/* Successful typeface patch retry */}
			{patchRetryResult?.success && (
				<Card tone="positive" border padding={3} radius={2}>
					<Text size={1}>Typeface document updated successfully on retry.</Text>
				</Card>
			)}

			{/* Failed typeface patch retry */}
			{patchRetryResult && !patchRetryResult.success && (
				<Card tone="critical" border padding={3} radius={2}>
					<Text size={1}>Retry failed: {patchRetryResult.error}</Text>
				</Card>
			)}

			{/* Close */}
			<Flex justify="flex-end">
				<Button
					mode="default"
					tone="primary"
					text="Close"
					onClick={onClose}
				/>
			</Flex>
		</Stack>
	);
}
