// Async font parser — ensures decompressor globals are set, with graceful WOFF2 fallback

import pako from 'pako';
import '../vendor/unbrotli.js';
import { Font } from 'lib-font';

// Immediately set globals — this runs at module evaluation time.
// lib-font's woff.js reads globalThis.pako and woff2.js reads globalThis.unbrotli
// at their top level. If this module evaluates before lib-font (which tsup guarantees
// since we import pako and unbrotli first), the globals will be set in time.
//
// When Vite re-bundles our package, it may reorder evaluation so lib-font's woff2.js
// captures globalThis.unbrotli as undefined. In that case, WOFF2 parsing will fail
// and buildUploadPlan falls back to TTF companion metadata.
globalThis.pako = pako;
// unbrotli.js UMD sets globalThis.unbrotli as a side effect — verify it worked
if (!globalThis.unbrotli) {
	console.warn('[parseFont] globalThis.unbrotli not set after vendor import — WOFF2 parsing may fail. TTF/OTF files will still work.');
}

/** Maximum font file size accepted for parsing (50 MB) */
const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Parse a font file from an ArrayBuffer.
 * Returns a lib-font Font object with all tables accessible via font.opentype.tables.*.
 *
 * WOFF2 note: If the brotli decoder couldn't be initialized (common with Vite pre-bundling),
 * WOFF2 files will fail to parse. The upload plan handles this gracefully — WOFF2 files
 * that share a name with a TTF/OTF get metadata from the companion file. Standalone WOFF2
 * uploads will show a clear error directing the user to also include TTF/OTF files.
 *
 * @param {ArrayBuffer} buffer - Raw font file bytes
 * @param {string} filename - Original filename (used for format detection by lib-font)
 * @returns {Promise<import('lib-font').Font>} Parsed lib-font Font object
 * @throws {Error} If the file exceeds MAX_FONT_FILE_SIZE or parsing fails
 */
export async function parseFont(buffer, filename) {
	if (buffer.byteLength > MAX_FONT_FILE_SIZE) {
		throw new Error(`Font file exceeds ${MAX_FONT_FILE_SIZE / 1024 / 1024}MB limit: ${filename} (${(buffer.byteLength / 1024 / 1024).toFixed(1)}MB)`);
	}

	return new Promise((resolve, reject) => {
		const font = new Font('font', { skipStyleSheet: true });
		font.onload = (evt) => resolve(evt.detail.font);
		font.onerror = (evt) => {
			const msg = evt.detail?.message || `Failed to parse ${filename}`;
			reject(new Error(msg));
		};
		try {
			font.fromDataBuffer(buffer, filename);
		} catch (err) {
			// lib-font may throw synchronously from WOFF2 constructor if brotli decoder is missing
			reject(new Error(`${filename}: ${err.message}`));
		}
	});
}
