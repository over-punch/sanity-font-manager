// Execution reducer — manages ExecutionState separately from the plan to prevent progress ticks from re-rendering the review UI

import { EXECUTION_STATUS } from './planTypes';

/**
 * Creates the initial execution state.
 * @returns {object}
 */
export function createInitialExecutionState() {
	return {
		status: 'idle',
		progress: {},
		error: null,
	};
}

/**
 * Execution reducer for useReducer. Manages per-font upload progress.
 * Mounted in UploadStep3Execute — isolated from the plan/review UI.
 *
 * @param {object} state - Current ExecutionState
 * @param {object} action - Dispatched action
 * @returns {object} New ExecutionState
 */
export function executionReducer(state, action) {
	switch (action.type) {
		case 'SET_EXECUTION_STATUS': {
			return { ...state, status: action.status };
		}

		case 'SET_FONT_EXECUTION_PROGRESS': {
			const { tempId, progress } = action;
			return {
				...state,
				progress: {
					...state.progress,
					[tempId]: {
						...(state.progress[tempId] || {}),
						...progress,
					},
				},
			};
		}

		case 'SET_EXECUTION_ERROR': {
			return {
				...state,
				status: 'error',
				error: action.error,
			};
		}

		default:
			return state;
	}
}
