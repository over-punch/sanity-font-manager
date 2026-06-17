// Upload modal — multi-step state machine: Upload Files → Review → Execute → Map Instances → Summary

import React, { useReducer, useCallback, useState, useMemo, useRef, useEffect } from 'react';
import { Dialog, Box, Flex, Text, Badge, Button } from '@sanity/ui';
import { planReducer } from '../utils/planReducer';
import { createEmptyPlan, PLAN_PHASE } from '../utils/planTypes';
import { buildUploadPlan } from '../utils/buildUploadPlan';
import { generateStyleKeywords } from '../utils/generateKeywords';
import UploadStep1Settings from './UploadStep1Settings';
import UploadStep2Review from './UploadStep2Review';
import UploadStep3Execute from './UploadStep3Execute';
import UploadStep3bInstances from './UploadStep3bInstances';
import UploadSummary from './UploadSummary';

/** Step labels for the step indicator */
const STEPS = [
	{ key: 1, label: 'Upload Files' },
	{ key: 2, label: 'Review' },
	{ key: 3, label: 'Upload' },
	{ key: 4, label: 'Map Instances' },
];

/** Maps plan phase to active step number */
function phaseToStep(phase) {
	switch (phase) {
		case PLAN_PHASE.IDLE: return 1;
		case PLAN_PHASE.PROCESSING: return 2;
		case PLAN_PHASE.REVIEWING: return 2;
		case PLAN_PHASE.READY: return 2;
		case PLAN_PHASE.EXECUTING: return 3;
		case PLAN_PHASE.COMPLETE: return 3;
		case PLAN_PHASE.ERROR: return 3;
		default: return 1;
	}
}

/**
 * Upload modal — wraps the 3-step upload workflow in a Sanity UI Dialog.
 */
export default function UploadModal({
	open,
	onClose,
	client,
	docId,
	typefaceTitle,
	stylesObject,
	preferredStyleRef,
	slug,
	defaults = {},
}) {
	const [plan, dispatch] = useReducer(planReducer, null, () => createEmptyPlan({
		price: defaults.price ?? 0,
		preserveShortenedNames: defaults.preserveShortenedNames ?? false,
		preserveFileNames: defaults.preserveFileNames ?? false,
	}));
	const [processingCancelled, setProcessingCancelled] = useState(false);
	const [executionResult, setExecutionResult] = useState(null);
	const [retryTempIds, setRetryTempIds] = useState(null);
	const [instanceMappingPhase, setInstanceMappingPhase] = useState(false);
	const [instanceMappingResult, setInstanceMappingResult] = useState(null);
	const cancelRef = useRef(false);
	const focusRef = useRef(null);

	const { weightKeywordList, italicKeywordList } = useMemo(() => generateStyleKeywords(), []);
	const hasVFs = useMemo(() =>
		Object.values(plan.fonts).some(f => f.variableFont && f.status !== 'error'),
		[plan.fonts]
	);
	const baseStep = phaseToStep(plan.phase);
	// Instance mapping is step 4 — only shown after execution completes with VFs
	const currentStep = instanceMappingPhase ? 4 : (plan.phase === PLAN_PHASE.COMPLETE && !instanceMappingResult ? baseStep : baseStep);
	const isExecuting = plan.phase === PLAN_PHASE.EXECUTING;

	// Prevent accidental close during upload
	useEffect(() => {
		if (!open || !isExecuting) return;
		const handler = (e) => { e.preventDefault(); e.returnValue = ''; };
		window.addEventListener('beforeunload', handler);
		return () => window.removeEventListener('beforeunload', handler);
	}, [open, isExecuting]);

	// Focus management on step transitions
	useEffect(() => {
		if (focusRef.current) {
			focusRef.current.focus();
		}
	}, [currentStep]);

	/** Handle close — confirm if plan has data, block during execution */
	const handleClose = useCallback(() => {
		if (isExecuting) return;
		const hasFonts = Object.keys(plan.fonts).length > 0;
		if (hasFonts && plan.phase !== PLAN_PHASE.COMPLETE) {
			if (!window.confirm('Close the upload modal? All progress will be lost.')) return;
		}
		dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.IDLE });
		setExecutionResult(null);
		onClose();
	}, [plan, isExecuting, onClose]);

	/** Start processing — transition to Step 2 and build the plan */
	const handleStartProcessing = useCallback(async (files, settings) => {
		dispatch({ type: 'SET_SETTINGS', settings: { ...settings, typefaceTitle } });
		dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.PROCESSING, totalFiles: files.length });
		cancelRef.current = false;
		setProcessingCancelled(false);
		setExecutionResult(null);

		try {
			const builtPlan = await buildUploadPlan({
				files,
				typefaceTitle,
				docId,
				settings,
				client,
				stylesObject,
				weightKeywordList,
				italicKeywordList,
				onProgress: (event) => {
					if (cancelRef.current) return;
					// Update progress counter only — don't add entries yet (they haven't been merged by documentId)
					if (event.type === 'font-processed' || event.type === 'font-error') {
						dispatch({ type: 'UPDATE_PROCESSING_PROGRESS', progress: event.progress });
					}
				},
			});

			if (!cancelRef.current) {
				// Dispatch the final merged plan entries (files with the same documentId are already grouped)
				for (const [tempId, entry] of Object.entries(builtPlan.fonts)) {
					dispatch({ type: 'ADD_PROCESSED_FONT', tempId, fontEntry: entry });
				}
				dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.REVIEWING });
			}
		} catch (err) {
			console.error('Processing failed:', err);
			dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.REVIEWING });
		}
	}, [typefaceTitle, docId, client, stylesObject, weightKeywordList, italicKeywordList]);

	/** Cancel processing and return to Step 1 */
	const handleCancelProcessing = useCallback(() => {
		cancelRef.current = true;
		setProcessingCancelled(true);
		dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.IDLE });
	}, []);

	/** Transition to execution */
	const handleStartExecution = useCallback(() => {
		dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.EXECUTING });
	}, []);

	/** Receive execution result — transition to instance mapping if VFs exist, otherwise complete */
	const handleExecutionComplete = useCallback((result) => {
		setExecutionResult(result);
		if (hasVFs && result.success !== false) {
			// Show instance mapping step before summary
			setInstanceMappingPhase(true);
			dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.COMPLETE });
		} else {
			dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.COMPLETE });
		}
	}, [hasVFs]);

	/** Handle instance mapping completion */
	const handleInstanceMappingComplete = useCallback((result) => {
		setInstanceMappingResult(result);
		setInstanceMappingPhase(false);
	}, []);

	if (!open) return null;

	/** Navigate to a step by clicking the step indicator */
	const handleStepClick = useCallback((stepKey) => {
		if (isExecuting) return;
		if (stepKey === currentStep) return;
		// Can only go back to step 1 (reset to settings)
		if (stepKey === 1 && currentStep > 1) {
			if (Object.keys(plan.fonts).length > 0) {
				if (!window.confirm('Go back to settings? Current review progress will be lost.')) return;
			}
			dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.IDLE });
		}
	}, [currentStep, isExecuting, plan.fonts, dispatch]);

	return (
		<Dialog
			id="upload-modal"
			header={
				<Flex direction="column" gap={3} style={{ width: '100%' }}>
					<Text weight="semibold" size={2}>Upload Fonts</Text>
					<Flex gap={1} style={{ width: '100%' }}>
						{STEPS.filter(step => step.key !== 4 || hasVFs).map((step, i) => {
							const isActive = currentStep === step.key;
							const isCompleted = currentStep > step.key;
							const isClickable = !isExecuting && step.key < currentStep;
							return (
								<Box
									key={step.key}
									as={isClickable ? 'button' : 'div'}
									onClick={isClickable ? () => handleStepClick(step.key) : undefined}
									style={{
										flex: 1,
										padding: '10px 12px',
										border: 'none',
										borderRadius: 4,
										cursor: isClickable ? 'pointer' : 'default',
										background: isActive
											? 'var(--card-badge-primary-bg-color)'
											: isCompleted
												? 'var(--card-badge-positive-bg-color)'
												: 'var(--card-muted-bg-color)',
										color: isActive || isCompleted
											? '#fff'
											: 'var(--card-muted-fg-color)',
										textAlign: 'center',
										transition: 'background 0.15s ease',
										opacity: !isActive && !isCompleted ? 0.6 : 1,
									}}
								>
									<Text
										size={1}
										weight={isActive ? 'bold' : 'medium'}
										style={{ color: 'inherit' }}
									>
										{step.key}. {step.label}
									</Text>
								</Box>
							);
						})}
					</Flex>
				</Flex>
			}
			width={2}
			onClose={isExecuting ? undefined : handleClose}
			onClickOutside={() => {}}
		>
			<Box padding={4}>
				{/* Step 1: Settings & File Selection */}
				{currentStep === 1 && (
					<UploadStep1Settings
						settings={plan.settings}
						onStartProcessing={handleStartProcessing}
					/>
				)}

				{/* Step 2: Processing & Review */}
				{currentStep === 2 && (
					<UploadStep2Review
						plan={plan}
						dispatch={dispatch}
						onCancelProcessing={handleCancelProcessing}
						onStartExecution={handleStartExecution}
						processingCancelled={processingCancelled}
					/>
				)}

				{/* Step 3: Upload Execution */}
				{currentStep === 3 && plan.phase !== PLAN_PHASE.COMPLETE && (
					<UploadStep3Execute
						key={retryTempIds ? 'retry' : 'initial'}
						plan={plan}
						client={client}
						docId={docId}
						stylesObject={stylesObject}
						preferredStyleRef={preferredStyleRef}
						retryTempIds={retryTempIds}
						onComplete={(result) => {
							setRetryTempIds(null);
							handleExecutionComplete(result);
						}}
					/>
				)}

				{/* Step 4: Variable Font Instance Mapping (only if VFs in batch) */}
				{plan.phase === PLAN_PHASE.COMPLETE && instanceMappingPhase && (
					<UploadStep3bInstances
						plan={plan}
						executionResult={executionResult}
						client={client}
						typefaceTitle={typefaceTitle}
						onComplete={handleInstanceMappingComplete}
					/>
				)}

				{/* Post-completion Summary */}
				{plan.phase === PLAN_PHASE.COMPLETE && !instanceMappingPhase && (
					<UploadSummary
						plan={plan}
						result={executionResult}
						instanceMappingResult={instanceMappingResult}
						onClose={handleClose}
						onRetry={(failedTempIds) => {
							setRetryTempIds(failedTempIds || null);
							setExecutionResult(null);
							setInstanceMappingPhase(false);
							setInstanceMappingResult(null);
							dispatch({ type: 'SET_PHASE', phase: PLAN_PHASE.EXECUTING });
						}}
						client={client}
						docId={docId}
						stylesObject={stylesObject}
						preferredStyleRef={preferredStyleRef}
					/>
				)}
			</Box>
		</Dialog>
	);
}
