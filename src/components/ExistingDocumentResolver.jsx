// Existing document resolution UI — toggle between update existing and create new

import React from 'react';
import { Card, Stack, Flex, Text, Badge, Button, Label, Switch, Tooltip, Box } from '@sanity/ui';
import { InfoOutlineIcon } from '@sanity/icons';
import { RECOMMENDATION } from '../utils/planTypes';

/**
 * Displays the existing document resolution decision as a toggle.
 * When "update" is on, shows the matched document. When off, indicates a new document will be created.
 */
export default function ExistingDocumentResolver({ decision, tempId, dispatch }) {
	if (!decision) return null;

	const { recommendation, exact, candidates, userChoice, selectedCandidate, lookupFailed } = decision;

	const effectiveAction = userChoice ||
		(recommendation === RECOMMENDATION.USE_EXACT || recommendation === RECOMMENDATION.USE_CANDIDATE ? 'update' : 'create');
	const isUpdating = effectiveAction === 'update';
	const hasMatch = exact || candidates?.length > 0;

	const handleToggle = () => {
		dispatch({ type: 'SET_FONT_ACTION', tempId, decision: isUpdating ? 'create' : 'update' });
	};

	const handleSelectCandidate = (candidate) => {
		dispatch({ type: 'SET_FONT_CANDIDATE', tempId, candidate });
	};

	// Lookup failed
	if (lookupFailed) {
		return (
			<Card tone="caution" border padding={2} radius={1}>
				<Text size={0}>Could not check for existing documents — will create new.</Text>
			</Card>
		);
	}

	// No match at all — just creating
	if (recommendation === RECOMMENDATION.CREATE && !userChoice) {
		return (
			<Stack space={2}>
				<Label size={0}>Existing Document</Label>
				<Card tone="default" border padding={2} radius={1}>
					<Text size={1}>No existing document found — will create new.</Text>
				</Card>
			</Stack>
		);
	}

	// Has a match (exact, candidate, or ambiguous) — show toggle
	if (hasMatch) {
		const matchDoc = exact || selectedCandidate || candidates?.[0];
		const matchType = exact ? 'Exact Match' : candidates?.length > 1 ? 'Multiple Matches' : 'Likely Match';
		const matchTone = exact ? 'positive' : 'caution';

		return (
			<Stack space={2}>
				<Label size={0}>Existing Document</Label>

				{/* Toggle */}
				<Flex align="center" gap={2}>
					<Switch
						checked={isUpdating}
						onChange={handleToggle}
						style={{ cursor: 'pointer' }}
					/>
					<Stack space={1}>
						<Text size={1} weight="semibold">
							{isUpdating ? 'Update existing document' : 'Create new document'}
						</Text>
						<Text size={0} muted>
							{isUpdating
								? 'Files will be uploaded to the matched document below.'
								: 'A new document will be created. You may need to update the Document ID above to avoid conflicts.'
							}
						</Text>
					</Stack>
				</Flex>

				{/* Match card — greyed out when not updating */}
				<Card
					tone={isUpdating ? matchTone : 'default'}
					border
					padding={2}
					radius={1}
					style={{ opacity: isUpdating ? 1 : 0.5, transition: 'opacity 0.15s ease' }}
				>
					<Stack space={2}>
						<Flex align="center" gap={2}>
							<Badge tone={isUpdating ? matchTone : 'default'} fontSize={0}>{matchType}</Badge>
							<Text size={1} style={{ fontFamily: 'monospace' }}>{matchDoc?._id}</Text>
						</Flex>
						<Text size={0} muted>
							{matchDoc?.title} · {matchDoc?.weightName} · {matchDoc?.style}
							{matchDoc?.subfamily ? ` · ${matchDoc.subfamily}` : ''}
						</Text>
					</Stack>
				</Card>

				{/* Multiple candidates — show selector when updating */}
				{isUpdating && candidates?.length > 1 && (
					<Stack space={1}>
						<Text size={0} muted>Select which document to update:</Text>
						{candidates.map((candidate) => (
							<Card
								key={candidate._id}
								border
								radius={1}
								padding={2}
								tone={selectedCandidate?._id === candidate._id ? 'positive' : 'default'}
								style={{ cursor: 'pointer' }}
								onClick={() => handleSelectCandidate(candidate)}
							>
								<Flex align="center" gap={2}>
									<input
										type="radio"
										name={`candidate-${tempId}`}
										checked={selectedCandidate?._id === candidate._id}
										onChange={() => handleSelectCandidate(candidate)}
										style={{ cursor: 'pointer' }}
									/>
									<Stack space={1} style={{ flex: 1 }}>
										<Text size={1} style={{ fontFamily: 'monospace' }}>{candidate._id}</Text>
										<Text size={0} muted>
											{candidate.title} · {candidate.weightName} · {candidate.style}
											{candidate.subfamily ? ` · ${candidate.subfamily}` : ''}
										</Text>
									</Stack>
								</Flex>
							</Card>
						))}
					</Stack>
				)}
			</Stack>
		);
	}

	// User chose create after initially having a match (fallback)
	if (userChoice === 'create') {
		return (
			<Stack space={2}>
				<Label size={0}>Existing Document</Label>
				<Card border padding={2} radius={1}>
					<Text size={1}>Will create new document</Text>
				</Card>
			</Stack>
		);
	}

	return null;
}
