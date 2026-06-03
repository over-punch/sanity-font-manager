// Tests for planReducer — all action types with happy paths, edge cases, and guards
import { describe, it, expect } from 'vitest';
import { planReducer } from '../utils/planReducer';
import { createEmptyPlan, createFontDecisions, PLAN_PHASE, FONT_STATUS } from '../utils/planTypes';

/** Creates a minimal font plan entry for testing */
function mockFontEntry(overrides = {}) {
	const tempId = overrides.tempId || 'myfont-bold-abc123';
	return {
		tempId,
		files: [],
		sourceFileName: 'MyFont-Bold.ttf',
		title: 'MyFont Bold',
		documentId: 'myfont-bold',
		weight: 700,
		weightName: 'Bold',
		style: 'Regular',
		subfamily: 'Display',
		variableFont: false,
		originalFilename: null,
		decisions: createFontDecisions({
			titleSource: 'fontkit-fullName',
			title: 'MyFont Bold',
			titleOriginal: 'MyFont-Bold',
			documentId: 'myfont-bold',
			weight: 700,
			weightSource: 'os2-usWeightClass',
			weightName: 'Bold',
			style: 'Regular',
			styleSource: 'default-regular',
			subfamily: 'Display',
			subfamilySource: 'preferredFamily-subtraction',
		}),
		status: FONT_STATUS.PROCESSED,
		error: null,
		parsedMetadata: null,
		glyphCount: 500,
		opentypeFeatures: ['kern', 'liga'],
		variationAxes: null,
		...overrides,
	};
}

/** Creates a plan with one font entry pre-loaded */
function planWithFont(fontOverrides = {}, planOverrides = {}) {
	const entry = mockFontEntry(fontOverrides);
	const plan = createEmptyPlan();
	plan.fonts[entry.tempId] = entry;
	plan.subfamilyGroups[entry.subfamily || 'default'] = {
		title: entry.subfamily || 'default',
		fontIds: [entry.tempId],
	};
	return { ...plan, ...planOverrides };
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

describe('SET_PHASE', () => {
	it('transitions idle → processing', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'SET_PHASE', phase: PLAN_PHASE.PROCESSING });
		expect(result.phase).toBe(PLAN_PHASE.PROCESSING);
	});

	it('rejects invalid transition (idle → reviewing)', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'SET_PHASE', phase: PLAN_PHASE.REVIEWING });
		expect(result.phase).toBe(PLAN_PHASE.IDLE);
	});

	it('allows any → idle (reset)', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.EXECUTING };
		const result = planReducer(state, { type: 'SET_PHASE', phase: PLAN_PHASE.IDLE });
		expect(result.phase).toBe(PLAN_PHASE.IDLE);
	});

	it('transitions executing → complete', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.EXECUTING };
		const result = planReducer(state, { type: 'SET_PHASE', phase: PLAN_PHASE.COMPLETE });
		expect(result.phase).toBe(PLAN_PHASE.COMPLETE);
	});

	it('transitions executing → error', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.EXECUTING };
		const result = planReducer(state, { type: 'SET_PHASE', phase: PLAN_PHASE.ERROR });
		expect(result.phase).toBe(PLAN_PHASE.ERROR);
	});
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

describe('SET_SETTINGS', () => {
	it('updates settings during idle phase', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'SET_SETTINGS', settings: { price: 50 } });
		expect(result.settings.price).toBe(50);
	});

	it('blocks settings changes during processing phase', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.PROCESSING };
		const result = planReducer(state, { type: 'SET_SETTINGS', settings: { price: 50 } });
		expect(result.settings.price).toBe(0);
	});

	it('allows settings changes during reviewing phase', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.REVIEWING };
		const result = planReducer(state, { type: 'SET_SETTINGS', settings: { price: 50 } });
		expect(result.settings.price).toBe(50);
	});

	it('blocks settings changes during executing phase', () => {
		const state = { ...createEmptyPlan(), phase: PLAN_PHASE.EXECUTING };
		const result = planReducer(state, { type: 'SET_SETTINGS', settings: { price: 50 } });
		expect(result.settings.price).toBe(0);
	});

	it('merges partial settings', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'SET_SETTINGS', settings: { preserveFileNames: true } });
		expect(result.settings.preserveFileNames).toBe(true);
		expect(result.settings.preserveShortenedNames).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Processing actions
// ---------------------------------------------------------------------------

describe('ADD_PROCESSED_FONT', () => {
	it('adds a new font entry', () => {
		const state = createEmptyPlan();
		const entry = mockFontEntry();
		const result = planReducer(state, { type: 'ADD_PROCESSED_FONT', tempId: entry.tempId, fontEntry: entry });
		expect(result.fonts[entry.tempId]).toBeDefined();
		expect(result.fonts[entry.tempId].title).toBe('MyFont Bold');
		expect(result.processingProgress.completed).toBe(1);
	});

	it('adds font to subfamily group', () => {
		const state = createEmptyPlan();
		const entry = mockFontEntry({ subfamily: 'Condensed' });
		const result = planReducer(state, { type: 'ADD_PROCESSED_FONT', tempId: entry.tempId, fontEntry: entry });
		expect(result.subfamilyGroups['Condensed']).toBeDefined();
		expect(result.subfamilyGroups['Condensed'].fontIds).toContain(entry.tempId);
	});

	it('merges processing-owned fields on duplicate tempId, preserves user overrides', () => {
		const entry = mockFontEntry();
		const state = planWithFont({
			...entry,
			title: 'User Edited Title',
			decisions: {
				...entry.decisions,
				title: { ...entry.decisions.title, userOverride: 'User Edited Title' },
			},
		});

		const updatedEntry = { ...entry, glyphCount: 999, status: FONT_STATUS.PROCESSED };
		const result = planReducer(state, { type: 'ADD_PROCESSED_FONT', tempId: entry.tempId, fontEntry: updatedEntry });

		// Processing-owned field updated
		expect(result.fonts[entry.tempId].glyphCount).toBe(999);
		// User override preserved
		expect(result.fonts[entry.tempId].decisions.title.userOverride).toBe('User Edited Title');
		// Non-processing field preserved
		expect(result.fonts[entry.tempId].title).toBe('User Edited Title');
	});

	it('does not add duplicate tempId to subfamily group fontIds', () => {
		const state = createEmptyPlan();
		const entry = mockFontEntry();
		let result = planReducer(state, { type: 'ADD_PROCESSED_FONT', tempId: entry.tempId, fontEntry: entry });
		result = planReducer(result, { type: 'ADD_PROCESSED_FONT', tempId: entry.tempId, fontEntry: entry });
		const group = result.subfamilyGroups[entry.subfamily];
		expect(group.fontIds.filter(id => id === entry.tempId)).toHaveLength(1);
	});
});

describe('SET_PROCESSING_ERROR', () => {
	it('marks font as error and increments failed count', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_PROCESSING_ERROR', tempId, error: 'Parse failed' });
		expect(result.fonts[tempId].status).toBe(FONT_STATUS.ERROR);
		expect(result.fonts[tempId].error).toBe('Parse failed');
		expect(result.processingProgress.failed).toBe(1);
	});

	it('no-ops for non-existent font', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'SET_PROCESSING_ERROR', tempId: 'nonexistent', error: 'fail' });
		expect(result).toBe(state);
	});
});

// ---------------------------------------------------------------------------
// User edits
// ---------------------------------------------------------------------------

describe('SET_FONT_TITLE', () => {
	it('updates title and sets userOverride', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_TITLE', tempId, title: 'New Title' });
		expect(result.fonts[tempId].title).toBe('New Title');
		expect(result.fonts[tempId].decisions.title.userOverride).toBe('New Title');
		expect(result.fonts[tempId].decisions.title.source).toBe('user-override');
	});

	it('auto-derives documentId when documentId has no userOverride', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_TITLE', tempId, title: 'New Title Here' });
		expect(result.fonts[tempId].documentId).toBe('new-title-here');
	});

	it('does NOT auto-derive documentId when documentId has userOverride', () => {
		const entry = mockFontEntry();
		entry.decisions.documentId.userOverride = 'custom-id';
		const state = planWithFont(entry);
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_TITLE', tempId, title: 'New Title' });
		expect(result.fonts[tempId].documentId).toBe('myfont-bold'); // unchanged
	});
});

describe('SET_FONT_DOCUMENT_ID', () => {
	it('sanitizes and sets documentId', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_DOCUMENT_ID', tempId, documentId: 'My Custom ID' });
		expect(result.fonts[tempId].documentId).toBe('my-custom-id');
		expect(result.fonts[tempId].decisions.documentId.userOverride).toBe('My Custom ID');
	});

	it('detects ID collision with another font', () => {
		const entry1 = mockFontEntry({ tempId: 'font-1', documentId: 'font-alpha' });
		const entry2 = mockFontEntry({ tempId: 'font-2', documentId: 'font-beta' });
		let state = createEmptyPlan();
		state.fonts['font-1'] = entry1;
		state.fonts['font-2'] = entry2;

		const result = planReducer(state, { type: 'SET_FONT_DOCUMENT_ID', tempId: 'font-2', documentId: 'font-alpha' });
		expect(result.fonts['font-1']._idConflict).toBe(true);
		expect(result.fonts['font-2']._idConflict).toBe(true);
	});
});

describe('SET_FONT_WEIGHT', () => {
	it('clamps weight to 1-1000 range', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];

		let result = planReducer(state, { type: 'SET_FONT_WEIGHT', tempId, weight: 0 });
		expect(result.fonts[tempId].weight).toBe(1);

		result = planReducer(state, { type: 'SET_FONT_WEIGHT', tempId, weight: 1500 });
		expect(result.fonts[tempId].weight).toBe(1000);

		result = planReducer(state, { type: 'SET_FONT_WEIGHT', tempId, weight: 450 });
		expect(result.fonts[tempId].weight).toBe(450);
	});
});

describe('SET_FONT_WEIGHT_NAME', () => {
	it('updates weightName and sets decisions.weightName.userOverride', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_WEIGHT_NAME', tempId, weightName: 'SemiBold' });
		expect(result.fonts[tempId].weightName).toBe('SemiBold');
		expect(result.fonts[tempId].decisions.weightName.userOverride).toBe('SemiBold');
	});
});

describe('SET_FONT_STYLE', () => {
	it('updates style and userOverride', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_STYLE', tempId, style: 'Italic' });
		expect(result.fonts[tempId].style).toBe('Italic');
		expect(result.fonts[tempId].decisions.style.userOverride).toBe('Italic');
	});
});

describe('SET_FONT_SUBFAMILY', () => {
	it('moves font between subfamily groups', () => {
		const state = planWithFont({ subfamily: 'Display' });
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_SUBFAMILY', tempId, subfamily: 'Text' });

		expect(result.fonts[tempId].subfamily).toBe('Text');
		expect(result.subfamilyGroups['Text']?.fontIds).toContain(tempId);
		// Old group should be removed if empty
		expect(result.subfamilyGroups['Display']).toBeUndefined();
	});
});

describe('SET_FONT_ACTION', () => {
	it('sets userChoice to create', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_ACTION', tempId, decision: 'create' });
		expect(result.fonts[tempId].decisions.existingDocument.userChoice).toBe('create');
		expect(result.fonts[tempId].decisions.existingDocument.selectedCandidate).toBeNull();
	});

	it('sets userChoice to update', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'SET_FONT_ACTION', tempId, decision: 'update' });
		expect(result.fonts[tempId].decisions.existingDocument.userChoice).toBe('update');
	});
});

describe('SET_FONT_CANDIDATE', () => {
	it('sets selectedCandidate and updates documentId', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const candidate = { _id: 'existing-font-123', title: 'Existing Font' };
		const result = planReducer(state, { type: 'SET_FONT_CANDIDATE', tempId, candidate });
		expect(result.fonts[tempId].decisions.existingDocument.selectedCandidate).toEqual(candidate);
		expect(result.fonts[tempId].decisions.existingDocument.userChoice).toBe('update');
		expect(result.fonts[tempId].documentId).toBe('existing-font-123');
	});
});

// ---------------------------------------------------------------------------
// Subfamily organization
// ---------------------------------------------------------------------------

describe('MOVE_FONT_TO_SUBFAMILY', () => {
	it('moves font and creates target group if needed', () => {
		const state = planWithFont({ subfamily: 'Display' });
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, {
			type: 'MOVE_FONT_TO_SUBFAMILY', tempId, fromSubfamily: 'Display', toSubfamily: 'Narrow',
		});
		expect(result.fonts[tempId].subfamily).toBe('Narrow');
		expect(result.subfamilyGroups['Narrow']?.fontIds).toContain(tempId);
		expect(result.subfamilyGroups['Display']).toBeUndefined();
	});
});

describe('CREATE_SUBFAMILY_GROUP', () => {
	it('creates an empty group', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'CREATE_SUBFAMILY_GROUP', title: 'Micro' });
		expect(result.subfamilyGroups['Micro']).toEqual({ title: 'Micro', fontIds: [] });
	});

	it('no-ops if group already exists', () => {
		const state = createEmptyPlan();
		state.subfamilyGroups['Micro'] = { title: 'Micro', fontIds: ['some-id'] };
		const result = planReducer(state, { type: 'CREATE_SUBFAMILY_GROUP', title: 'Micro' });
		expect(result.subfamilyGroups['Micro'].fontIds).toEqual(['some-id']);
	});
});

describe('REMOVE_SUBFAMILY_GROUP', () => {
	it('removes an empty group', () => {
		const state = createEmptyPlan();
		state.subfamilyGroups['Empty'] = { title: 'Empty', fontIds: [] };
		const result = planReducer(state, { type: 'REMOVE_SUBFAMILY_GROUP', title: 'Empty' });
		expect(result.subfamilyGroups['Empty']).toBeUndefined();
	});

	it('blocks removal of group with fonts', () => {
		const state = planWithFont({ subfamily: 'Display' });
		const result = planReducer(state, { type: 'REMOVE_SUBFAMILY_GROUP', title: 'Display' });
		expect(result.subfamilyGroups['Display']).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// Bulk actions
// ---------------------------------------------------------------------------

describe('ACCEPT_ALL_SUGGESTIONS', () => {
	it('resets all user overrides to null', () => {
		const entry = mockFontEntry();
		entry.title = 'User Title';
		entry.decisions.title.userOverride = 'User Title';
		entry.decisions.weight.userOverride = 800;
		const state = planWithFont(entry);
		const tempId = Object.keys(state.fonts)[0];

		const result = planReducer(state, { type: 'ACCEPT_ALL_SUGGESTIONS' });
		expect(result.fonts[tempId].title).toBe('MyFont Bold'); // back to processed
		expect(result.fonts[tempId].decisions.title.userOverride).toBeNull();
		expect(result.fonts[tempId].decisions.weight.userOverride).toBeNull();
	});

	it('respects scope array — only resets specified fonts', () => {
		const entry1 = mockFontEntry({ tempId: 'font-1', title: 'Edited 1' });
		entry1.decisions.title.userOverride = 'Edited 1';
		const entry2 = mockFontEntry({ tempId: 'font-2', title: 'Edited 2', documentId: 'font-2' });
		entry2.decisions.title.userOverride = 'Edited 2';

		let state = createEmptyPlan();
		state.fonts['font-1'] = entry1;
		state.fonts['font-2'] = entry2;

		const result = planReducer(state, { type: 'ACCEPT_ALL_SUGGESTIONS', scope: ['font-1'] });
		expect(result.fonts['font-1'].decisions.title.userOverride).toBeNull();
		expect(result.fonts['font-2'].decisions.title.userOverride).toBe('Edited 2');
	});
});

describe('RESET_FONT_TO_SUGGESTIONS', () => {
	it('resets a single font', () => {
		const entry = mockFontEntry();
		entry.weight = 800;
		entry.decisions.weight.userOverride = 800;
		const state = planWithFont(entry);
		const tempId = Object.keys(state.fonts)[0];

		const result = planReducer(state, { type: 'RESET_FONT_TO_SUGGESTIONS', tempId });
		expect(result.fonts[tempId].weight).toBe(700); // back to detected
		expect(result.fonts[tempId].decisions.weight.userOverride).toBeNull();
	});
});

describe('REMOVE_FONT', () => {
	it('removes font from fonts map and subfamily group', () => {
		const state = planWithFont();
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'REMOVE_FONT', tempId });
		expect(result.fonts[tempId]).toBeUndefined();
		expect(Object.values(result.subfamilyGroups).flatMap(g => g.fontIds)).not.toContain(tempId);
	});

	it('cleans up empty subfamily group after removal', () => {
		const state = planWithFont({ subfamily: 'Display' });
		const tempId = Object.keys(state.fonts)[0];
		const result = planReducer(state, { type: 'REMOVE_FONT', tempId });
		expect(result.subfamilyGroups['Display']).toBeUndefined();
	});

	it('no-ops for non-existent font', () => {
		const state = createEmptyPlan();
		const result = planReducer(state, { type: 'REMOVE_FONT', tempId: 'nonexistent' });
		expect(result).toBe(state);
	});
});
