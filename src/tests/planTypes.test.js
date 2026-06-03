// Tests for planTypes — constants, enums, factory functions
import { describe, it, expect } from 'vitest';
import {
	FONT_STATUS,
	PLAN_PHASE,
	RECOMMENDATION,
	EXECUTION_STATUS,
	PLAN_VERSION,
	CONCURRENCY_LIMIT,
	MAX_RETRIES,
	backoffWithJitter,
	createFontDecisions,
	createEmptyPlan,
} from '../utils/planTypes';

describe('planTypes constants', () => {
	it('FONT_STATUS has all required values', () => {
		expect(FONT_STATUS.PENDING).toBe('pending');
		expect(FONT_STATUS.PROCESSING).toBe('processing');
		expect(FONT_STATUS.PROCESSED).toBe('processed');
		expect(FONT_STATUS.ERROR).toBe('error');
	});

	it('PLAN_PHASE has all required values', () => {
		expect(PLAN_PHASE.IDLE).toBe('idle');
		expect(PLAN_PHASE.PROCESSING).toBe('processing');
		expect(PLAN_PHASE.REVIEWING).toBe('reviewing');
		expect(PLAN_PHASE.READY).toBe('ready');
		expect(PLAN_PHASE.EXECUTING).toBe('executing');
		expect(PLAN_PHASE.COMPLETE).toBe('complete');
		expect(PLAN_PHASE.ERROR).toBe('error');
	});

	it('RECOMMENDATION has all required values', () => {
		expect(RECOMMENDATION.USE_EXACT).toBe('use-exact');
		expect(RECOMMENDATION.USE_CANDIDATE).toBe('use-candidate');
		expect(RECOMMENDATION.AMBIGUOUS).toBe('ambiguous');
		expect(RECOMMENDATION.CREATE).toBe('create');
	});

	it('EXECUTION_STATUS includes PATCHING_TYPEFACE', () => {
		expect(EXECUTION_STATUS.PATCHING_TYPEFACE).toBe('patching-typeface');
		expect(EXECUTION_STATUS.QUEUED).toBe('queued');
		expect(EXECUTION_STATUS.COMPLETE).toBe('complete');
		expect(EXECUTION_STATUS.ERROR).toBe('error');
		expect(EXECUTION_STATUS.SKIPPED).toBe('skipped');
	});

	it('PLAN_VERSION is 1', () => {
		expect(PLAN_VERSION).toBe(1);
	});

	it('CONCURRENCY_LIMIT is 3', () => {
		expect(CONCURRENCY_LIMIT).toBe(3);
	});
});

describe('backoffWithJitter', () => {
	it('returns a value near the expected base for attempt 0', () => {
		const delays = Array.from({ length: 100 }, () => backoffWithJitter(0));
		const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
		// Base for attempt 0 is 1000ms, jitter ±25% = 750-1250
		expect(avg).toBeGreaterThan(700);
		expect(avg).toBeLessThan(1300);
	});

	it('increases with attempt number', () => {
		const d0 = backoffWithJitter(0);
		const d2 = backoffWithJitter(2);
		// attempt 2 base is 4000ms vs attempt 0 base 1000ms
		// Even with jitter, attempt 2 should generally be larger
		// (test with averages to account for randomness)
		const avg0 = Array.from({ length: 50 }, () => backoffWithJitter(0)).reduce((a, b) => a + b, 0) / 50;
		const avg2 = Array.from({ length: 50 }, () => backoffWithJitter(2)).reduce((a, b) => a + b, 0) / 50;
		expect(avg2).toBeGreaterThan(avg0 * 2);
	});
});

describe('createFontDecisions', () => {
	it('returns a complete decisions object with defaults', () => {
		const d = createFontDecisions({});
		expect(d.title.source).toBe('fontkit-fullName');
		expect(d.title.userOverride).toBeNull();
		expect(d.documentId.source).toBe('derived-from-title');
		expect(d.weight.source).toBe('default-400');
		expect(d.weight.detected).toBe(400);
		expect(d.weightName.detected).toBe('');
		expect(d.style.source).toBe('default-regular');
		expect(d.style.detected).toBe('Regular');
		expect(d.subfamily.source).toBe('default-empty');
		expect(d.existingDocument.recommendation).toBe('create');
		expect(d.existingDocument.lookupFailed).toBe(false);
	});

	it('accepts custom values', () => {
		const d = createFontDecisions({
			titleSource: 'filename',
			title: 'MyFont Bold',
			weight: 700,
			weightSource: 'os2-usWeightClass',
			style: 'Italic',
			styleSource: 'italic-angle',
		});
		expect(d.title.source).toBe('filename');
		expect(d.title.processed).toBe('MyFont Bold');
		expect(d.weight.detected).toBe(700);
		expect(d.style.detected).toBe('Italic');
	});
});

describe('createEmptyPlan', () => {
	it('returns a valid plan with default settings', () => {
		const plan = createEmptyPlan();
		expect(plan.version).toBe(PLAN_VERSION);
		expect(plan.settings.price).toBe(0);
		expect(plan.settings.preserveShortenedNames).toBe(false);
		expect(plan.settings.preserveFileNames).toBe(false);
		expect(plan.fonts).toEqual({});
		expect(plan.subfamilyGroups).toEqual({});
		expect(plan.phase).toBe(PLAN_PHASE.IDLE);
		expect(plan.processingProgress.total).toBe(0);
	});

	it('merges custom settings', () => {
		const plan = createEmptyPlan({ price: 50, preserveFileNames: true });
		expect(plan.settings.price).toBe(50);
		expect(plan.settings.preserveFileNames).toBe(true);
		expect(plan.settings.preserveShortenedNames).toBe(false);
	});
});
