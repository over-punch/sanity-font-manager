// Plan reducer — manages UploadPlan state for the upload modal review UI

import { PLAN_PHASE, FONT_STATUS, PROCESSING_OWNED_FIELDS } from './planTypes';
import { sanitizeForSanityId } from './sanitizeForSanityId';
import { retitleAllFonts } from './retitleFontEntries';
import { mergeFontEntries } from './mergeFontEntries';

/** Valid phase transitions — any phase can transition to 'idle' (reset) */
const VALID_TRANSITIONS = {
	[PLAN_PHASE.IDLE]: [PLAN_PHASE.PROCESSING],
	[PLAN_PHASE.PROCESSING]: [PLAN_PHASE.REVIEWING],
	[PLAN_PHASE.REVIEWING]: [PLAN_PHASE.READY, PLAN_PHASE.EXECUTING],
	[PLAN_PHASE.READY]: [PLAN_PHASE.EXECUTING],
	[PLAN_PHASE.EXECUTING]: [PLAN_PHASE.COMPLETE, PLAN_PHASE.ERROR],
	[PLAN_PHASE.COMPLETE]: [PLAN_PHASE.EXECUTING],
	[PLAN_PHASE.ERROR]: [PLAN_PHASE.EXECUTING],
};

/**
 * Plan reducer for useReducer. Manages the UploadPlan state.
 * Write domain isolation: processing actions only write processing-owned fields;
 * user edit actions only write decisions.*.userOverride.
 *
 * @param {object} state - Current UploadPlan
 * @param {object} action - Dispatched action
 * @returns {object} New UploadPlan
 */
export function planReducer(state, action) {
	switch (action.type) {
		// ---------------------------------------------------------------
		// Phase / Settings
		// ---------------------------------------------------------------

		case 'SET_PHASE': {
			if (action.phase === PLAN_PHASE.IDLE) {
				return { ...state, phase: PLAN_PHASE.IDLE };
			}
			const validNext = VALID_TRANSITIONS[state.phase] || [];
			if (!validNext.includes(action.phase)) {
				console.warn(`Invalid phase transition: ${state.phase} → ${action.phase}`);
				return state;
			}
			const nextState = { ...state, phase: action.phase };
			// Allow setting total file count when entering PROCESSING phase
			if (typeof action.totalFiles === 'number') {
				nextState.processingProgress = {
					...state.processingProgress,
					total: action.totalFiles,
					completed: 0,
					failed: 0,
					currentFile: null,
				};
			}
			return nextState;
		}

		case 'SET_SETTINGS': {
			if (state.phase !== PLAN_PHASE.IDLE && state.phase !== PLAN_PHASE.REVIEWING && state.phase !== PLAN_PHASE.READY) {
				console.warn('SET_SETTINGS blocked — settings locked during processing/execution');
				return state;
			}
			const newSettings = { ...state.settings, ...action.settings };
			let newState = { ...state, settings: newSettings };

			// Retitle fonts when either naming setting changes during review. Both change what the
			// title and document ID are derived from, so leaving the entries alone made the file
			// names switch look like it did nothing.
			const shortenedChanged = 'preserveShortenedNames' in action.settings
				&& action.settings.preserveShortenedNames !== state.settings.preserveShortenedNames;
			const fileNamesChanged = 'preserveFileNames' in action.settings
				&& action.settings.preserveFileNames !== state.settings.preserveFileNames;
			if ((shortenedChanged || fileNamesChanged) && Object.keys(state.fonts).length > 0) {
				const typefaceTitle = action.typefaceTitle || state.settings.typefaceTitle || '';
				const retitled = retitleAllFonts(
					state.fonts,
					newSettings.preserveShortenedNames,
					typefaceTitle,
					newSettings.preserveFileNames,
				);
				const subfamilyGroups = rebuildSubfamilyGroups(retitled);
				newState = { ...newState, fonts: retitled, subfamilyGroups };
			}

			return newState;
		}

		// ---------------------------------------------------------------
		// Processing (Phase 1) — dispatched by buildUploadPlan callbacks
		// ---------------------------------------------------------------

		case 'UPDATE_PROCESSING_PROGRESS': {
			return {
				...state,
				processingProgress: { ...state.processingProgress, ...action.progress },
			};
		}

		case 'ADD_PROCESSED_FONT': {
			const { tempId, fontEntry } = action;
			const fonts = { ...state.fonts };

			if (fonts[tempId]) {
				// Font already exists (user may have edited) — merge processing-owned fields only
				const existing = fonts[tempId];
				const merged = { ...existing };
				for (const field of PROCESSING_OWNED_FIELDS) {
					merged[field] = fontEntry[field];
				}
				fonts[tempId] = merged;
			} else {
				fonts[tempId] = fontEntry;
			}

			// Update subfamily groups
			const subfamilyGroups = { ...state.subfamilyGroups };
			const sfName = fontEntry.subfamily || 'default';
			if (!fontEntry.variableFont || fontEntry.subfamily) {
				if (!subfamilyGroups[sfName]) {
					subfamilyGroups[sfName] = { title: sfName, fontIds: [] };
				}
				// Guard against duplicate tempId in fontIds
				if (!subfamilyGroups[sfName].fontIds.includes(tempId)) {
					subfamilyGroups[sfName] = {
						...subfamilyGroups[sfName],
						fontIds: [...subfamilyGroups[sfName].fontIds, tempId],
					};
				}
			}

			return {
				...state,
				// An entry added after review has begun (a retried file) can collide with one already
				// on screen, so conflicts are recomputed rather than assumed absent.
				fonts: markConflicts(fonts),
				subfamilyGroups,
				processingProgress: {
					...state.processingProgress,
					completed: state.processingProgress.completed + 1,
				},
			};
		}

		case 'SET_PROCESSING_ERROR': {
			const { tempId, error } = action;
			if (!state.fonts[tempId]) return state;
			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: { ...state.fonts[tempId], status: FONT_STATUS.ERROR, error },
				},
				processingProgress: {
					...state.processingProgress,
					failed: state.processingProgress.failed + 1,
				},
			};
		}

		// ---------------------------------------------------------------
		// User Edits (Review Step)
		// ---------------------------------------------------------------

		case 'SET_FONT_TITLE': {
			const { tempId, title, source: titleSource } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			// When source is provided (e.g. from clicking a name table suggestion), preserve it.
			// The display layer appends "(user override)" — don't bake it into the source string.
			const newSource = titleSource || 'user-override';

			const updated = {
				...font,
				title,
				decisions: {
					...font.decisions,
					title: { ...font.decisions.title, userOverride: title, source: newSource },
				},
			};

			// Auto-derive documentId unless it has its own override
			if (!font.decisions.documentId.userOverride) {
				const newDocId = sanitizeForSanityId(title);
				updated.documentId = newDocId;
				updated.decisions = {
					...updated.decisions,
					documentId: { ...updated.decisions.documentId, generated: newDocId },
				};
			}

			return updateFontAndCheckConflicts(state, tempId, updated);
		}

		case 'SET_FONT_DOCUMENT_ID': {
			const { tempId, documentId } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			const sanitized = sanitizeForSanityId(documentId);
			const updated = {
				...font,
				documentId: sanitized,
				decisions: {
					...font.decisions,
					documentId: { ...font.decisions.documentId, userOverride: documentId },
				},
			};

			return updateFontAndCheckConflicts(state, tempId, updated);
		}

		case 'SET_FONT_WEIGHT': {
			const { tempId, weight } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			const clamped = Math.max(1, Math.min(1000, weight));
			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: {
						...font,
						weight: clamped,
						decisions: {
							...font.decisions,
							weight: { ...font.decisions.weight, userOverride: clamped },
						},
					},
				},
			};
		}

		case 'SET_FONT_WEIGHT_NAME': {
			const { tempId, weightName } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: {
						...font,
						weightName,
						decisions: {
							...font.decisions,
							weightName: { ...font.decisions.weightName, userOverride: weightName },
						},
					},
				},
			};
		}

		case 'SET_FONT_STYLE': {
			const { tempId, style } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: {
						...font,
						style,
						decisions: {
							...font.decisions,
							style: { ...font.decisions.style, userOverride: style },
						},
					},
				},
			};
		}

		case 'SET_FONT_SUBFAMILY': {
			const { tempId, subfamily } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			const oldSubfamily = font.subfamily || 'default';
			const newSubfamily = subfamily || 'default';

			const updated = {
				...font,
				subfamily,
				decisions: {
					...font.decisions,
					subfamily: { ...font.decisions.subfamily, userOverride: subfamily },
				},
			};

			let newState = { ...state, fonts: { ...state.fonts, [tempId]: updated } };

			// Move between subfamily groups
			if (oldSubfamily !== newSubfamily) {
				newState = moveFontBetweenGroups(newState, tempId, oldSubfamily, newSubfamily);
			}

			return newState;
		}

		case 'SET_FONT_ACTION': {
			const { tempId, decision } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			const existingDoc = { ...font.decisions.existingDocument, userChoice: decision };
			if (decision === 'create') {
				existingDoc.selectedCandidate = null;
			}

			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: {
						...font,
						decisions: { ...font.decisions, existingDocument: existingDoc },
					},
				},
			};
		}

		case 'SET_FONT_CANDIDATE': {
			const { tempId, candidate } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			return {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: {
						...font,
						documentId: candidate._id,
						decisions: {
							...font.decisions,
							existingDocument: {
								...font.decisions.existingDocument,
								selectedCandidate: candidate,
								userChoice: 'update',
							},
						},
					},
				},
			};
		}

		// ---------------------------------------------------------------
		// Subfamily Organization
		// ---------------------------------------------------------------

		case 'MOVE_FONT_TO_SUBFAMILY': {
			const { tempId, fromSubfamily, toSubfamily } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			let newState = {
				...state,
				fonts: {
					...state.fonts,
					[tempId]: { ...font, subfamily: toSubfamily },
				},
			};
			return moveFontBetweenGroups(newState, tempId, fromSubfamily, toSubfamily);
		}

		case 'CREATE_SUBFAMILY_GROUP': {
			const { title } = action;
			if (state.subfamilyGroups[title]) return state;
			return {
				...state,
				subfamilyGroups: {
					...state.subfamilyGroups,
					[title]: { title, fontIds: [] },
				},
			};
		}

		case 'REMOVE_SUBFAMILY_GROUP': {
			const { title } = action;
			const group = state.subfamilyGroups[title];
			if (!group) return state;
			if (group.fontIds.length > 0) {
				console.warn('Cannot remove subfamily group with fonts — reassign fonts first');
				return state;
			}
			const { [title]: _, ...remaining } = state.subfamilyGroups;
			return { ...state, subfamilyGroups: remaining };
		}

		// ---------------------------------------------------------------
		// Bulk Actions
		// ---------------------------------------------------------------

		case 'ACCEPT_ALL_SUGGESTIONS': {
			const scope = action.scope || Object.keys(state.fonts);
			const fonts = { ...state.fonts };

			for (const tempId of scope) {
				if (!fonts[tempId]) continue;
				fonts[tempId] = resetFontToSuggestions(fonts[tempId]);
			}

			// Rebuild subfamily groups after resetting. Reverting a title can both create a
			// collision and clear one, so conflicts are recomputed rather than left as they were.
			const subfamilyGroups = rebuildSubfamilyGroups(fonts);
			return { ...state, fonts: markConflicts(fonts), subfamilyGroups };
		}

		case 'RESET_FONT_TO_SUGGESTIONS': {
			const { tempId } = action;
			const font = state.fonts[tempId];
			if (!font) return state;

			const reset = resetFontToSuggestions(font);
			const fonts = { ...state.fonts, [tempId]: reset };
			const subfamilyGroups = rebuildSubfamilyGroups(fonts);
			return { ...state, fonts: markConflicts(fonts), subfamilyGroups };
		}

		// ---------------------------------------------------------------
		// Merge
		// ---------------------------------------------------------------

		case 'MERGE_FONTS': {
			const { tempIds, primaryTempId, fileSources } = action;
			const entries = (tempIds || []).map(id => state.fonts[id]).filter(Boolean);
			if (entries.length < 2) {
				console.warn('MERGE_FONTS needs at least two existing entries');
				return state;
			}

			const { merged } = mergeFontEntries(entries, { primaryTempId, fileSources });

			const fonts = { ...state.fonts };
			for (const entry of entries) {
				delete fonts[entry.tempId];
			}
			fonts[merged.tempId] = merged;

			const subfamilyGroups = rebuildSubfamilyGroups(fonts);
			return { ...state, fonts: markConflicts(fonts), subfamilyGroups };
		}

		case 'REMOVE_FONT': {
			const { tempId } = action;
			if (!state.fonts[tempId]) return state;

			const { [tempId]: removed, ...remainingFonts } = state.fonts;

			// Remove from subfamily groups
			const subfamilyGroups = {};
			for (const [key, group] of Object.entries(state.subfamilyGroups)) {
				const filtered = group.fontIds.filter(id => id !== tempId);
				if (filtered.length > 0) {
					subfamilyGroups[key] = { ...group, fontIds: filtered };
				}
			}

			// Removing one half of a duplicate pair resolves the conflict — without this the
			// survivor keeps a flag nothing can clear and the upload button stays disabled.
			return { ...state, fonts: markConflicts(remainingFonts), subfamilyGroups };
		}

		default:
			return state;
	}
}

// -----------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------

/** Resets a font entry's overrides back to system-detected values */
function resetFontToSuggestions(font) {
	const d = font.decisions;
	return {
		...font,
		title: d.title.processed,
		documentId: d.documentId.generated,
		weight: d.weight.detected,
		weightName: d.weightName.detected,
		style: d.style.detected,
		subfamily: d.subfamily.detected,
		_idConflict: false,
		decisions: {
			...d,
			title: { ...d.title, userOverride: null, source: d.title.original ? d.title.source : d.title.source },
			documentId: { ...d.documentId, userOverride: null },
			weight: { ...d.weight, userOverride: null },
			weightName: { ...d.weightName, userOverride: null },
			style: { ...d.style, userOverride: null },
			subfamily: { ...d.subfamily, userOverride: null },
			existingDocument: { ...d.existingDocument, userChoice: null, selectedCandidate: null },
		},
	};
}

/** Moves a font between subfamily groups, creating/removing groups as needed */
function moveFontBetweenGroups(state, tempId, fromKey, toKey) {
	const groups = { ...state.subfamilyGroups };

	// Remove from old group
	if (groups[fromKey]) {
		const filtered = groups[fromKey].fontIds.filter(id => id !== tempId);
		if (filtered.length === 0) {
			delete groups[fromKey];
		} else {
			groups[fromKey] = { ...groups[fromKey], fontIds: filtered };
		}
	}

	// Add to new group (guard against duplicates)
	if (!groups[toKey]) {
		groups[toKey] = { title: toKey, fontIds: [] };
	}
	if (!groups[toKey].fontIds.includes(tempId)) {
		groups[toKey] = { ...groups[toKey], fontIds: [...groups[toKey].fontIds, tempId] };
	}

	return { ...state, subfamilyGroups: groups };
}

/**
 * Recomputes `_idConflict` across a whole fonts map. Always call this after any action that
 * adds, removes, or renames an entry — a flag left over from a pair that no longer exists
 * blocks the upload button with nothing left on screen to fix.
 * @param {object} fontsMap - plan.fonts
 * @returns {object} New fonts map with accurate conflict flags
 */
function markConflicts(fontsMap) {
	const fonts = {};
	const idMap = {};

	for (const [id, font] of Object.entries(fontsMap)) {
		fonts[id] = { ...font, _idConflict: false };
		const docId = font.documentId;
		if (!idMap[docId]) {
			idMap[docId] = [id];
		} else {
			idMap[docId].push(id);
		}
	}

	for (const ids of Object.values(idMap)) {
		if (ids.length > 1) {
			for (const id of ids) {
				fonts[id] = { ...fonts[id], _idConflict: true };
			}
		}
	}

	return fonts;
}

/** Updates a font and checks for documentId collisions across all fonts */
function updateFontAndCheckConflicts(state, tempId, updatedFont) {
	return { ...state, fonts: markConflicts({ ...state.fonts, [tempId]: updatedFont }) };
}

/** Rebuilds subfamily groups from the fonts map */
function rebuildSubfamilyGroups(fonts) {
	const groups = {};
	for (const [tempId, font] of Object.entries(fonts)) {
		if (font.status === FONT_STATUS.ERROR) continue;
		const sfName = font.subfamily || 'default';
		if (!font.variableFont || font.subfamily) {
			if (!groups[sfName]) {
				groups[sfName] = { title: sfName, fontIds: [] };
			}
			if (!groups[sfName].fontIds.includes(tempId)) {
				groups[sfName].fontIds.push(tempId);
			}
		}
	}
	return groups;
}
