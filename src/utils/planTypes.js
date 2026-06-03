// Type constants and enums for the two-phase upload plan — single source of truth

/** @enum {string} — Font processing status within the plan */
export const FONT_STATUS = {
	PENDING: 'pending',
	PROCESSING: 'processing',
	PROCESSED: 'processed',
	ERROR: 'error',
};

/** @enum {string} — Modal phase state machine */
export const PLAN_PHASE = {
	IDLE: 'idle',
	PROCESSING: 'processing',
	REVIEWING: 'reviewing',
	READY: 'ready',
	EXECUTING: 'executing',
	COMPLETE: 'complete',
	ERROR: 'error',
};

/** @enum {string} — Document resolution recommendation from resolveExistingFont */
export const RECOMMENDATION = {
	USE_EXACT: 'use-exact',
	USE_CANDIDATE: 'use-candidate',
	AMBIGUOUS: 'ambiguous',
	CREATE: 'create',
};

/** @enum {string} — Per-font execution progress status */
export const EXECUTION_STATUS = {
	QUEUED: 'queued',
	UPLOADING_ASSETS: 'uploading-assets',
	GENERATING_CSS: 'generating-css',
	GENERATING_METADATA: 'generating-metadata',
	CREATING_DOCUMENT: 'creating-document',
	PATCHING_TYPEFACE: 'patching-typeface',
	COMPLETE: 'complete',
	ERROR: 'error',
	SKIPPED: 'skipped',
};

/** Processing-owned fields — only written by ADD_PROCESSED_FONT, never by user edit actions */
export const PROCESSING_OWNED_FIELDS = ['parsedMetadata', 'glyphCount', 'opentypeFeatures', 'variationAxes', 'status'];

/** User-owned fields — only written by user edit actions via decisions.*.userOverride */
export const USER_OWNED_FIELDS = ['title', 'documentId', 'weight', 'weightName', 'style', 'subfamily'];

/** Current plan schema version — increment on breaking shape changes */
export const PLAN_VERSION = 1;

/** Maximum concurrent asset uploads */
export const CONCURRENCY_LIMIT = 3;

/** Maximum retry attempts for 429 rate-limited requests */
export const MAX_RETRIES = 3;

/** Base backoff delay in ms for exponential retry */
export const BASE_BACKOFF_MS = 1000;

/** Jitter factor for exponential backoff (±25%) */
export const JITTER_FACTOR = 0.25;

/**
 * Calculate backoff delay with jitter for retry logic.
 * @param {number} attempt - Zero-based attempt number
 * @returns {number} Delay in milliseconds
 */
export function backoffWithJitter(attempt) {
	const base = BASE_BACKOFF_MS * Math.pow(2, attempt);
	const jitter = base * JITTER_FACTOR * (Math.random() * 2 - 1);
	return Math.round(base + jitter);
}

/**
 * Creates an empty FontDecisions object with default sources.
 * @param {object} params
 * @param {string} params.titleSource
 * @param {string} params.title
 * @param {string} params.titleOriginal
 * @param {string} params.documentId
 * @param {number} params.weight
 * @param {string} params.weightSource
 * @param {string|null} params.matchedKeyword
 * @param {string} params.weightName
 * @param {string} params.weightNameSource
 * @param {string} params.style
 * @param {string} params.styleSource
 * @param {string} params.styleReason
 * @param {string} params.subfamily
 * @param {string} params.subfamilySource
 * @param {Array} params.titleAlternatives
 * @returns {object}
 */
export function createFontDecisions({
	titleSource = 'fontkit-fullName',
	title = '',
	titleOriginal = '',
	documentId = '',
	weight = 400,
	weightSource = 'default-400',
	matchedKeyword = null,
	weightName = '',
	weightNameSource = 'nameId17-preferredSubfamily',
	style = 'Regular',
	styleSource = 'default-regular',
	styleReason = '',
	subfamily = '',
	subfamilySource = 'default-empty',
	titleAlternatives = [],
}) {
	return {
		title: {
			source: titleSource,
			original: titleOriginal,
			processed: title,
			alternatives: titleAlternatives,
			userOverride: null,
		},
		documentId: {
			source: 'derived-from-title',
			generated: documentId,
			userOverride: null,
		},
		weight: {
			source: weightSource,
			detected: weight,
			matchedKeyword,
			rawWeightName: weightName,
			userOverride: null,
		},
		weightName: {
			source: weightNameSource,
			detected: weightName,
			userOverride: null,
		},
		style: {
			source: styleSource,
			detected: style,
			reason: styleReason,
			userOverride: null,
		},
		subfamily: {
			source: subfamilySource,
			detected: subfamily,
			userOverride: null,
		},
		existingDocument: {
			recommendation: RECOMMENDATION.CREATE,
			exact: null,
			candidates: [],
			userChoice: null,
			selectedCandidate: null,
			lookupFailed: false,
		},
	};
}

/**
 * Creates an initial empty UploadPlan.
 * @param {object} settings
 * @returns {object}
 */
export function createEmptyPlan(settings = {}) {
	return {
		version: PLAN_VERSION,
		settings: {
			price: 0,
			preserveShortenedNames: false,
			preserveFileNames: false,
			...settings,
		},
		fonts: {},
		subfamilyGroups: {},
		phase: PLAN_PHASE.IDLE,
		processingProgress: {
			total: 0,
			completed: 0,
			failed: 0,
			currentFile: null,
		},
	};
}
