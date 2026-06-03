// Tests for executionReducer — execution state management
import { describe, it, expect } from 'vitest';
import { executionReducer, createInitialExecutionState } from '../utils/executionReducer';

describe('executionReducer', () => {
	describe('SET_EXECUTION_STATUS', () => {
		it('transitions from idle to uploading', () => {
			const state = createInitialExecutionState();
			const result = executionReducer(state, { type: 'SET_EXECUTION_STATUS', status: 'uploading' });
			expect(result.status).toBe('uploading');
		});

		it('transitions from uploading to patching-typeface', () => {
			const state = { ...createInitialExecutionState(), status: 'uploading' };
			const result = executionReducer(state, { type: 'SET_EXECUTION_STATUS', status: 'patching-typeface' });
			expect(result.status).toBe('patching-typeface');
		});

		it('transitions to complete', () => {
			const state = { ...createInitialExecutionState(), status: 'uploading' };
			const result = executionReducer(state, { type: 'SET_EXECUTION_STATUS', status: 'complete' });
			expect(result.status).toBe('complete');
		});

		it('transitions to error', () => {
			const state = { ...createInitialExecutionState(), status: 'uploading' };
			const result = executionReducer(state, { type: 'SET_EXECUTION_STATUS', status: 'error' });
			expect(result.status).toBe('error');
		});
	});

	describe('SET_FONT_EXECUTION_PROGRESS', () => {
		it('sets progress for a new font', () => {
			const state = createInitialExecutionState();
			const result = executionReducer(state, {
				type: 'SET_FONT_EXECUTION_PROGRESS',
				tempId: 'font-1',
				progress: { status: 'uploading-assets', currentFile: 'ttf', filesComplete: 0, filesTotal: 3 },
			});
			expect(result.progress['font-1'].status).toBe('uploading-assets');
			expect(result.progress['font-1'].filesTotal).toBe(3);
		});

		it('merges progress updates for an existing font', () => {
			let state = createInitialExecutionState();
			state = executionReducer(state, {
				type: 'SET_FONT_EXECUTION_PROGRESS',
				tempId: 'font-1',
				progress: { status: 'uploading-assets', filesComplete: 0, filesTotal: 3, assetRefs: {} },
			});
			const result = executionReducer(state, {
				type: 'SET_FONT_EXECUTION_PROGRESS',
				tempId: 'font-1',
				progress: { filesComplete: 1, assetRefs: { ttf: 'file-abc' } },
			});
			expect(result.progress['font-1'].status).toBe('uploading-assets');
			expect(result.progress['font-1'].filesComplete).toBe(1);
			expect(result.progress['font-1'].filesTotal).toBe(3);
			expect(result.progress['font-1'].assetRefs.ttf).toBe('file-abc');
		});

		it('accumulates asset refs across formats', () => {
			let state = createInitialExecutionState();
			state = executionReducer(state, {
				type: 'SET_FONT_EXECUTION_PROGRESS',
				tempId: 'font-1',
				progress: { assetRefs: { ttf: 'file-ttf' } },
			});
			const result = executionReducer(state, {
				type: 'SET_FONT_EXECUTION_PROGRESS',
				tempId: 'font-1',
				progress: { assetRefs: { ttf: 'file-ttf', woff2: 'file-woff2' } },
			});
			expect(result.progress['font-1'].assetRefs.ttf).toBe('file-ttf');
			expect(result.progress['font-1'].assetRefs.woff2).toBe('file-woff2');
		});
	});

	describe('SET_EXECUTION_ERROR', () => {
		it('sets error and changes status to error', () => {
			const state = { ...createInitialExecutionState(), status: 'uploading' };
			const result = executionReducer(state, { type: 'SET_EXECUTION_ERROR', error: 'Network failure' });
			expect(result.status).toBe('error');
			expect(result.error).toBe('Network failure');
		});
	});

	describe('createInitialExecutionState', () => {
		it('returns idle state with empty progress', () => {
			const state = createInitialExecutionState();
			expect(state.status).toBe('idle');
			expect(state.progress).toEqual({});
			expect(state.error).toBeNull();
		});
	});

	describe('unknown action', () => {
		it('returns state unchanged', () => {
			const state = createInitialExecutionState();
			const result = executionReducer(state, { type: 'UNKNOWN_ACTION' });
			expect(result).toBe(state);
		});
	});
});
