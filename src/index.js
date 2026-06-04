// Entry point for @liiift-studio/sanity-font-manager — exports all font manager components, hooks, and utilities

// Bootstrap decompressors FIRST — sets globalThis.pako and globalThis.unbrotli
// before lib-font can be evaluated by any bundler. This must be the first import.
import './utils/setupDecompressors.js';

// Components
export { BatchUploadFonts } from './components/BatchUploadFonts.jsx';
export { GenerateCollectionsPairsComponent } from './components/GenerateCollectionsPairsComponent.jsx';
export { UpdateScriptsComponent } from './components/UpdateScriptsComponent.jsx';
export { SingleUploaderTool } from './components/SingleUploaderTool.jsx';
export { RegenerateSubfamiliesComponent } from './components/RegenerateSubfamiliesComponent.jsx';
export { UploadScriptsComponent } from './components/UploadScriptsComponent.jsx';
export { FontScriptUploaderComponent } from './components/FontScriptUploaderComponent.jsx';
export { default as StatusDisplay } from './components/StatusDisplay.jsx';
export { default as PriceInput } from './components/PriceInput.jsx';
export { default as UploadButton } from './components/UploadButton.jsx';
export { KeyValueInput } from './components/KeyValueInput.jsx';
export { KeyValueReferenceInput } from './components/KeyValueReferenceInput.jsx';
export { VariableInstanceReferencesInput } from './components/VariableInstanceReferencesInput.jsx';
export { PrimaryCollectionGeneratorTypeface } from './components/PrimaryCollectionGeneratorTypeface.jsx';
export { SetOTF } from './components/SetOTF.jsx';
export { StyleCountInput } from './components/StyleCountInput.jsx';
export { NestedObjectArraySelector } from './components/NestedObjectArraySelector.jsx';

// Hooks
export { useSanityClient } from './hooks/useSanityClient.js';
export { useNestedObjects } from './hooks/useNestedObjects.js';

// Core utilities
export { default as generateCssFile } from './utils/generateCssFile.js';
export { default as generateFontData } from './utils/generateFontData.js';
export { default as generateFontFile } from './utils/generateFontFile.js';
export { default as generateSubset } from './utils/generateSubset.js';
export { default as parseVariableFontInstances } from './utils/parseVariableFontInstances.js';
export { getEmptyFontKit } from './utils/getEmptyFontKit.js';
export { SCRIPTS, SCRIPTS_OBJECT, HtmlDescription, DISCOUNT_REQUIREMENT_TYPES, DISCOUNT_REQUIREMENT_TYPES_OBJECT } from './utils/utils.js';

// Font processing utilities
export {
	processFontFiles,
	readFontFile,
	extractFontMetadata,
	extractWeightName,
	extractWeightFromFullName,
	processSubfamilyName,
	processItalicKeywords,
	formatFontTitle,
	addItalicToFontTitle,
	createFontObject,
	determineWeight,
	sortFontObjects,
	logFontInfo,
} from './utils/processFontFiles.js';

export { uploadFontFiles } from './utils/uploadFontFiles.js';
export { updateTypefaceDocument } from './utils/updateTypefaceDocument.js';
export { renameFontDocuments } from './utils/regenerateFontData.js';
export { updateFontPrices } from './utils/updateFontPrices.js';
export { sanitizeForSanityId } from './utils/sanitizeForSanityId.js';

// Plan/Execute split — v3.0 upload modal architecture
export { buildUploadPlan } from './utils/buildUploadPlan.js';
export { executeUploadPlan } from './utils/executeUploadPlan.js';
export { resolveExistingFont } from './utils/resolveExistingFont.js';
export {
	FONT_STATUS,
	PLAN_PHASE,
	RECOMMENDATION,
	EXECUTION_STATUS,
	PLAN_VERSION,
	createFontDecisions,
	createEmptyPlan,
} from './utils/planTypes.js';
export { planReducer } from './utils/planReducer.js';
export { executionReducer, createInitialExecutionState } from './utils/executionReducer.js';

// Upload modal components
export { default as UploadModal } from './components/UploadModal.jsx';
export { default as UploadStep1Settings } from './components/UploadStep1Settings.jsx';
export { default as UploadStep2Review } from './components/UploadStep2Review.jsx';
export { default as UploadStep3Execute } from './components/UploadStep3Execute.jsx';
export { default as UploadStep3bInstances } from './components/UploadStep3bInstances.jsx';
export { default as UploadSummary } from './components/UploadSummary.jsx';
export { default as FontReviewCard } from './components/FontReviewCard.jsx';
export { default as ExistingDocumentResolver } from './components/ExistingDocumentResolver.jsx';
export { default as BulkActions } from './components/BulkActions.jsx';

// Font parsing (lib-font wrappers)
export { parseFont } from './utils/parseFont.js';
export {
	getNameString,
	getAllFeatureTags,
	getCharacterSet,
	getVariationAxes,
	getNamedInstances,
	getFontMetrics,
	getFontMetadata,
	getWeightClass,
	getFsSelection,
	getMacStyle,
	getItalicAngle,
	getGlyphCount,
	getFamilyClass,
	escapeCssFontName,
} from './utils/fontHelpers.js';

// Schema field definitions
export { openTypeField } from './schema/openTypeField.js';
export { styleCountField } from './schema/styleCountField.js';
export { stylisticSetField } from './schema/stylisticSetField.js';
export { createStylesField } from './schema/stylesField.js';

// Keyword utilities
export {
	generateStyleKeywords,
	reverseSpellingLookup,
	expandAbbreviations,
	removeWeightNames,
} from './utils/generateKeywords.js';
