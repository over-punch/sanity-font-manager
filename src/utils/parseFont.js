// Async font parser — wraps lib-font event model in a Promise with decompressor bootstrap

import pako from 'pako';

// Set decompressor globals BEFORE lib-font is imported.
// lib-font reads globalThis.pako and globalThis.unbrotli at module evaluation time
// (top of woff.js / woff2.js), not at parse time. These must be set before lib-font
// is first evaluated, so we use dynamic import() below to guarantee ordering.
globalThis.pako = pako;

// unbrotli is a UMD that sets globalThis.unbrotli as a side effect on evaluation.
// We vendor it from lib-font/lib/unbrotli.js because the subpath is not in
// lib-font's exports map (ERR_PACKAGE_PATH_NOT_EXPORTED).
import '../vendor/unbrotli.js';

// Lazy-loaded lib-font Font constructor — resolved on first parseFont() call.
// Using dynamic import() guarantees globalThis.pako and globalThis.unbrotli are
// set before lib-font evaluates, which static imports cannot guarantee in ESM.
let _Font = null;

/** Returns the lib-font Font constructor, loading it on first call */
async function getFont() {
	if (!_Font) {
		const mod = await import('lib-font');
		_Font = mod.Font;
	}
	return _Font;
}

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

	const Font = await getFont();

	return new Promise((resolve, reject) => {
		const font = new Font('font', { skipStyleSheet: true });
		font.onload = (evt) => resolve(evt.detail.font);
		font.onerror = (evt) => reject(new Error(evt.detail?.message || `Failed to parse ${filename}`));
		font.fromDataBuffer(buffer, filename);
	});
}
