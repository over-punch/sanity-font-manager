// Async font parser — wraps lib-font event model in a Promise.
// Decompressor globals (pako, unbrotli) are set by setupDecompressors.js
// which is imported at the top of index.js before this module loads.

import { Font } from 'lib-font';

/** Maximum font file size accepted for parsing (50 MB) */
const MAX_FONT_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Parse a font file from an ArrayBuffer.
 * Returns a lib-font Font object with all tables accessible via font.opentype.tables.*.
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
		font.onerror = (evt) => reject(new Error(evt.detail?.message || `Failed to parse ${filename}`));
		font.fromDataBuffer(buffer, filename);
	});
}
